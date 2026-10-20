import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the reporting view (lib/aid.mjs).
//
// Two jobs a reviewer does against the PRISMA 2020 statement: reading the
// manuscript for each checklist item, and writing the abstract. The first
// rests on quotes from the manuscript, checked against it; the second on the
// project's own counts and saved results, and a draft holding a number that
// material does not hold is dropped (plan 1.3). Only accept() writes: a
// checklist row marked reported, or the abstract placed in the manuscript.
import { register, jsonOf, quoteIn } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { resultFacts } from '../lib/helpers.mjs';
import { projectContext } from '../lib/assist.mjs';
import { checklistOf } from '../lib/checklist.mjs';
import { blankBlock } from '../lib/manuscript.mjs';
import { PRISMA_FIELDS } from '../schema.mjs';
import { get, update } from '../store.mjs';
import { unsupported, withoutLabels } from '../lib/numbers.mjs';
import { draftBlocks, results } from '../lib/results.mjs';
import { linkable, survivalFacts } from './analysis.mjs';
import { outcomes, analysisOf, PRIMARY } from '../lib/outcomes.mjs';
import { fields } from '../lib/fields.mjs';
import { researchType } from '../lib/workflow.mjs';

// The evidence map is built in lib/evidence-map.mjs. Loaded when present, so
// this module does not fail where that one is not yet part of the build; the
// narrative action is offered only once it has loaded.
let evidenceMap = null;
export const mapReady = import('../lib/evidence-map.mjs')
  .then(m => { evidenceMap = typeof m.evidenceMap === 'function' ? m.evidenceMap : null; }).catch(() => {});
/** For tests: the map builder to use in place of the module's. */
export const useEvidenceMap = fn => { evidenceMap = fn; };

const blocksOf = s => (s.manuscript?.blocks || []).filter(b => String(b.text || '').trim());
const manuscriptText = s => blocksOf(s).map(b => b.text).join('\n\n');
const norm = t => String(t || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** The heading a quote sits under, as a checklist "where reported" would name it. */
export function sectionOf(blocks, quote) {
  const q = norm(quote);
  const i = blocks.findIndex(b => norm(b.text).includes(q.slice(0, 60)));
  if (i < 0) return '';
  for (let j = i; j >= 0; j--) if (/^h[23]$/.test(blocks[j].type) && String(blocks[j].text).trim()) return String(blocks[j].text).trim();
  return '';
}

/**
 * Sorts the model's reply per checklist item into what can be shown. An item
 * reported or partly reported must carry a quote the manuscript contains; one
 * that does not is dropped, because it cannot be checked. Items a person has
 * already marked (reported, or not applicable) are left alone when the model
 * agrees; an item marked reported that the model finds missing is shown.
 * `by` names the model, recorded on a row marked reported from its proposal.
 * Items the reply leaves out are counted, not taken as reported.
 */
export function checklistItems(reply, s, by = 'model:unknown') {
  const text = manuscriptText(s);
  const blocks = s.manuscript?.blocks || [];
  const list = checklistOf(s), ITEMS = list.items;
  const byN = new Map(ITEMS.map(([n, name, what]) => [n, { name, what }]));
  const seen = new Set();
  let dropped = 0;
  const items = [];
  for (const r of reply || []) {
    const n = String(r?.item || '').trim();
    if (!byN.has(n) || seen.has(n)) continue;
    seen.add(n);
    const state = s[list.key]?.[n]?.state || '';
    const status = /^partial/i.test(r.status) ? 'partial' : /^reported/i.test(r.status) ? 'reported' : 'missing';
    const quote = String(r.quote || '').trim().slice(0, 400);
    if (status !== 'missing' && !quoteIn(quote, text)) { dropped++; continue; }
    if (state === 'na') continue;
    if (status === 'reported' && state === 'done') continue;
    const { name } = byN.get(n);
    const gap = String(r.missing || '').trim().slice(0, 240);
    if (status === 'reported') {
      const where = sectionOf(blocks, quote);
      items.push({ n, label: `${n} ${name}: reported`, quote, detail: where ? `In ${where}` : '',
        acceptLabel: 'Mark reported',
        ...proposeChecklist({ quote, key: list.key, n, by, where }) });
    } else {
      items.push({ n, label: `${n} ${name}: ${status === 'partial' ? 'partly reported' : 'not reported'}`,
        ...(status === 'partial' ? { quote } : {}), detail: [state === 'done' && 'Marked reported', gap].filter(Boolean).join(' · ') });
    }
  }
  const order = new Map(ITEMS.map(([n], i) => [n, i]));
  items.sort((a, b) => order.get(a.n) - order.get(b.n));
  const unassessed = ITEMS.filter(([n]) => !seen.has(n)).length;
  return { items: items.map(({ n, ...it }) => it), dropped, unassessed };
}

/** The Abstract section's heading index and end, or null when there is none. */
function abstractSection(blocks) {
  const at = blocks.findIndex(b => /^h[23]$/.test(b.type) && /^\s*abstract\s*$/i.test(b.text));
  if (at < 0) return null;
  let end = at + 1;
  while (end < blocks.length && !/^h[123]$/.test(blocks[end].type)) end++;
  return { at, end };
}

/** Whether the manuscript already has an abstract written under its heading. */
export function abstractWritten(blocks) {
  const sec = abstractSection(blocks);
  return !!sec && blocks.slice(sec.at + 1, sec.end).some(b => String(b.text || '').trim());
}

/**
 * The abstract goes at the top: under an existing Abstract heading, replacing
 * its empty starter paragraphs, or as a new Abstract section after the title.
 * An abstract already written is never stacked on: returns false and changes
 * nothing.
 */
export function insertAbstract(blocks, paragraphs) {
  const made = paragraphs.map(p => blankBlock('p', p));
  const sec = abstractSection(blocks);
  if (sec) {
    if (abstractWritten(blocks)) return false;
    blocks.splice(sec.at + 1, sec.end - sec.at - 1, ...made);
    return true;
  }
  const after = blocks[0]?.type === 'h1' ? 1 : 0;
  blocks.splice(after, 0, blankBlock('h2', 'Abstract'), ...made);
  return true;
}

/** Every outcome's pooled result, each named for its outcome. */
function pooledFacts(s) {
  const list = outcomes(s), named = list.length > 1;
  const out = list.map(o => ({ o, a: analysisOf(s, o.id) })).filter(x => x.a)
    .map(({ o, a }) => `Pooled analysis${named ? `, ${o.id === PRIMARY ? 'primary outcome' : 'outcome'} ${o.name}` : ''}:\n${resultFacts({ ...a, outcomeName: named ? o.name : a.outcomeName })}`);
  return out.length ? out : ['No pooled analysis'];
}

/** The facts an abstract may state, each from the project's own state. */
function abstractFacts(s) {
  const counts = PRISMA_FIELDS.filter(f => s.prisma?.[f.id] !== undefined && s.prisma[f.id] !== '')
    .map(f => `  ${f.label}: ${s.prisma[f.id]}`);
  const sources = [...new Set((s.searches || []).filter(r => r.status !== 'failed').map(r => r.source).filter(Boolean))];
  const reg = s.protocol?.registration || s.protocol?.registry || '';
  return [
    projectContext(s),
    counts.length ? `PRISMA flow counts:\n${counts.join('\n')}` : 'PRISMA flow counts: none entered',
    sources.length ? `Sources searched: ${sources.join(', ')}` : '',
    s.searchStrategy?.lastSearched ? `Last searched: ${s.searchStrategy.lastSearched}` : '',
    reg ? `Registration: ${reg}` : '',
    ...pooledFacts(s),
    s.survival?.km ? `Time-to-event analysis:\n${survivalFacts(s.survival)}` : '',
  ].filter(Boolean).join('\n\n');
}

const proposeChecklist = durableAction('checklist', ({ quote, key, n, by, where }) => {
  // The manuscript may have been edited since the check: the quote
  // is the evidence, so it must still be there.
  if (!quoteIn(quote, manuscriptText(get()))) return { refused: 'The quote is no longer in the manuscript' };
  update(st => {
    st[key] = { ...(st[key] || {}), [n]: { ...((st[key] || {})[n] || {}), state: 'done', by, ...(where ? { where } : {}) } };
    return st;
});
return `${n} marked reported`;
});

const proposeAbstract = durableAction('abstract', ({ paras, linked }) => {
  if (abstractWritten(get().manuscript?.blocks || [])) return { refused: 'The abstract already has text' };
  update(st => {
    st.manuscript = st.manuscript || { blocks: [], snapshot: {} };
    if (!insertAbstract(st.manuscript.blocks, paras)) return st;
    // The value each link was made at, so a later re-run marks it stale.
    st.manuscript.snapshot = { ...(st.manuscript.snapshot || {}), ...Object.fromEntries(linked) };
    return st;
});
return 'Added as Abstract';
});

const proposeNarrative = durableAction('map-narrative', ({ text }) => {
  let placed = false;
  update(st => {
    const bs = st.manuscript?.blocks || [];
    const at = bs.findIndex(b => /^h[23]$/.test(b.type) && /results/i.test(b.text || ''));
    if (at < 0) return st;
    let end = at + 1;
    while (end < bs.length && !(/^h[123]$/.test(bs[end].type) && bs[end].type <= bs[at].type)) end++;
    bs.splice(end, 0, blankBlock('p', text));
    placed = true;
    return st;
});
return placed ? 'Added to Results' : { refused: 'The manuscript has no Results heading' };
});

register('reporting', [
  {
    id: 'check-prisma',
    label: 'Check reporting items in manuscript',
    icon: 'flow',
    task: 'write',
    when: s => manuscriptText(s).length > 200,
    async run({ cfg, signal, brief, progress }) {
      const s = get();
      const text = manuscriptText(s), list = checklistOf(s);
      progress?.(`${list.items.length} items`);
      const out = await complete(cfg, P.messagesOf(P.reportingCheckPrisma, { brief, review: list.review, name: list.name,
        items: list.items.map(([n, name, what]) => `${n} ${name}: ${what}`).join('\n'), manuscript: text.slice(0, 40000) }),
      { prompt: P.reportingCheckPrisma, signal, temperature: 0, json: true });
      const got = jsonOf(out);
      const { items, dropped, unassessed } = checklistItems(got.items || [], s, `model:${cfg.model || 'unknown'}`);
      return {
        prompt: promptRef(P.reportingCheckPrisma),
        title: `${list.name} items in manuscript`,
        items,
        note: [text.length > 40000 && 'Manuscript read to 40000 characters', dropped && `${dropped} dropped for a quote not in the manuscript`,
          unassessed && `${unassessed} of ${list.items.length} items not assessed`,
          !items.length && !unassessed && !dropped && 'Every item reported or already marked'].filter(Boolean).join(' · '),
      };
    },
  },
  {
    id: 'draft-abstract',
    label: 'Draft structured abstract',
    icon: 'manuscript',
    task: 'write',
    when: s => !!(s.protocol?.title || s.paper?.title || (s.papers || []).length),
    async run({ cfg, signal, brief }) {
      const s = get();
      const facts = abstractFacts(s);
      const scoping = researchType(s).id === 'scoping-review';
      const out = (await complete(cfg, P.messagesOf(P.reportingAbstract, { brief, scoping, facts }), { prompt: P.reportingAbstract, signal, temperature: 0.1 })).trim();
      const prompt = promptRef(P.reportingAbstract);
      const paragraphs = out.split(/\n\s*\n|\n(?=[A-Z][A-Za-z ]{2,20}:)/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      // Checked against the facts alone: a number in the instructions ("at
      // most 300 words") or the brief would otherwise vouch for an invented one.
      const bad = unsupported(out, facts);
      if (!paragraphs.length || bad.length) return { title: 'Structured abstract', items: [], prompt,
        note: paragraphs.length ? `Dropped: the draft held numbers not in the project (${[...new Set(bad)].slice(0, 6).join(', ')})` : 'The model returned no text' };
      // Saved results quoted verbatim become links to them (plan J7).
      const joined = paragraphs.join('\n');
      const { paras, linked } = draftBlocks(joined, linkable(joined, results(s)));
      return {
        title: 'Structured abstract',
        prompt,
        items: [{
          label: paragraphs.join('\n'),
          detail: [`${paragraphs.length} paragraphs · ${out.split(/\s+/).length} words`,
            linked.size ? `${linked.size} linked ${linked.size === 1 ? 'result' : 'results'}` : ''].filter(Boolean).join(' · '),
          acceptLabel: 'Add as Abstract',
          ...proposeAbstract({ paras, linked: [...linked] }),
        }],
      };
    },
  },
  {
    // A scoping review reports what the evidence map shows: where sources
    // concentrate and where there are none. The counts are the map's, in code.
    id: 'draft-map-narrative',
    label: 'Draft narrative from evidence map',
    icon: 'manuscript',
    task: 'write',
    when: (s, ctx) => researchType(s).id === 'scoping-review' && typeof evidenceMap === 'function' && Boolean(mapAxes(s, ctx?.focus)),
    async run({ cfg, signal, brief, focus }) {
      const s = get();
      const axes = mapAxes(s, focus);
      if (!axes) throw new Error('Chart two fields first');
      const map = evidenceMap(s, axes.row.id, axes.col.id);
      const facts = mapFacts(s, map, axes);
      if (!facts) return { title: 'Evidence map narrative', note: 'The map is empty', items: [] };
      const out = (await complete(cfg, P.messagesOf(P.reportingMapNarrative, { brief, facts }), { prompt: P.reportingMapNarrative, signal, temperature: 0.1 })).trim().replace(/\s*\n+\s*/g, ' ');
      return { ...narrativeItems(s, out, facts), prompt: promptRef(P.reportingMapNarrative) };
    },
  },
]);

// ---- evidence map narrative -------------------------------------------------
const chartable = f => !f.analysis && (f.type === 'category' || f.type === 'text');
const levelName = x => (x && typeof x === 'object' ? x.label ?? x.name ?? x.value ?? x.id : x);

/**
 * The two fields the map is drawn over: those the reporting view reports in
 * focus, else the two charted fields held by the most sources with at least
 * two different values.
 */
export function mapAxes(s, focus) {
  const FS = fields(s).filter(chartable);
  const byId = id => FS.find(f => f.id === id);
  // The map on screen is the one saved with the project; a focus may name another.
  const r = focus?.rowFieldId || focus?.row || s.evidenceMap?.row, c = focus?.colFieldId || focus?.col || s.evidenceMap?.col;
  if (byId(r) && byId(c) && r !== c) return { row: byId(r), col: byId(c) };
  const held = FS.map(f => {
    const vals = Object.entries(s.values || {}).filter(([k]) => k.endsWith(`:${f.id}`)).map(([, v]) => String(v.reported_value ?? '').trim()).filter(Boolean);
    return { f, n: vals.length, levels: new Set(vals.map(v => v.toLowerCase())).size };
  }).filter(x => x.n >= 2 && x.levels >= 2).sort((a, b) => b.n - a.n);
  return held.length >= 2 ? { row: held[0].f, col: held[1].f } : null;
}

/** The map as the lines a model is given: every cell's count and sources, empty cells named. */
export function mapFacts(s, map, axes) {
  const rows = (map?.rows || []).map(levelName), cols = (map?.cols || []).map(levelName);
  if (!rows.length || !cols.length) return '';
  const papers = new Map((s.papers || []).map(p => [p.id, p]));
  const cite = id => { const p = papers.get(id); return p ? `${p.label}${p.key ? ` [@${p.key}]` : ''}` : ''; };
  const lines = [`Rows: ${axes.row.label}. Columns: ${axes.col.label}.`], empty = [];
  let any = false;
  rows.forEach((r, i) => cols.forEach((c, j) => {
    const cell = map.cells?.[i]?.[j] || { count: 0, paperIds: [] };
    if (!cell.count) { empty.push(`${r} × ${c}`); return; }
    any = true;
    lines.push(`- ${r} × ${c}: ${cell.count} (${(cell.paperIds || []).map(cite).filter(Boolean).join('; ')})`);
  }));
  if (!any) return '';
  if (empty.length) lines.push(`No sources: ${empty.join('; ')}`);
  return lines.join('\n').slice(0, 6000);
}

/**
 * The drafted paragraph, offered only when every number it states and every
 * source it cites is in the map's facts. Accepted, it goes at the end of the
 * Results section.
 */
export function narrativeItems(s, text, facts) {
  const title = 'Evidence map narrative';
  if (!text) return { title, note: 'The model returned no text', items: [] };
  const stray = [...new Set(unsupported(withoutLabels(text, s.papers), facts))];
  const given = new Set([...facts.matchAll(/\[@([^\]]+)\]/g)].map(m => m[1]));
  const cited = [...text.matchAll(/\[@([^\]]+)\]/g)].map(m => m[1]);
  const unknown = [...new Set(cited.filter(k => !given.has(k)))];
  const problems = [stray.length && `Not in the map: ${stray.join(', ')}`, unknown.length && `Not in the map: ${unknown.map(k => `[@${k}]`).join(', ')}`].filter(Boolean);
  return {
    title,
    items: [{
      label: text,
      detail: problems.join(' · ') || `${text.split(/\s+/).length} words`,
      acceptLabel: 'Add to Results',
      ...(problems.length ? { accept: null } : proposeNarrative({ text })),
    }],
  };
}

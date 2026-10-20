import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the appraisal view (lib/aid.mjs).
//
// Risk of bias is judged by a person, never by a model (plan 1.3, 6). These
// actions only find the passages a judgement rests on and draft the sentence
// that explains a judgement already made. Neither proposes a level, and
// accept() never touches s.assessments.
//
// The assessment record holds judgements only; it has no place for support
// text. What the instruments call "support for judgement" is kept where the
// project already keeps quoted evidence per study: the reader's notes, as a
// Quotation (verbatim, with its page) or an Interpretation (the rationale),
// the distinction plan D6 requires. The domain is named at the head of the
// note so it reads as support for that domain in the reader and in notes.csv.
import { register, jsonOf, quoteIn, pdfPages } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { get, update } from '../store.mjs';
import { appraisalTool } from '../schema.mjs';

const toolOf = s => appraisalTool(s.appraisalTool || 'rob2', s);
const paperOf = (s, id) => (s.papers || []).find(p => p.id === id);

// The same reading of the record as the view's: per instrument, with the flat
// pre-instrument shape counting as RoB 2.
function judgements(s, paperId, tool) {
  const rec = s.assessments?.[paperId];
  if (!rec) return {};
  if (rec[tool.id]) return rec[tool.id];
  return tool.id === 'rob2' ? Object.fromEntries(Object.entries(rec).filter(([k]) => typeof rec[k] === 'string')) : {};
}

const PAGE_CHARS = 6000, TOTAL_CHARS = 48000;

/**
 * The text a model reads for one study: the PDF page by page when there is
 * one, else the abstract. Pages are capped so a long report still fits; the
 * note says when the model read less than the whole document.
 */
async function sourceOf(paper, signal) {
  try {
    const { pages, total } = await pdfPages(paper.id, { signal });
    let used = 0; const kept = [];
    for (const pg of pages) {
      if (used >= TOTAL_CHARS) break;
      const text = pg.text.slice(0, Math.min(PAGE_CHARS, TOTAL_CHARS - used));
      kept.push({ page: pg.page, text }); used += text.length;
    }
    const whole = kept.length === total && kept.every((k, i) => k.text.length === pages[i].text.length);
    return { pages: kept, abstract: '', note: whole ? '' : `Read pages 1–${kept.length} of ${total}, shortened` };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { pages: [], abstract: paper.abstract || '', note: paper.abstract ? 'No PDF; read the abstract only' : '' };
  }
}

/** The source as prompt text, each page marked so a quote can name its page. */
export const sourceText = src => src.pages.length
  ? src.pages.map(p => `[page ${p.page}]\n${p.text}`).join('\n\n')
  : `[abstract]\n${src.abstract}`;

/** The domains an action covers: the focused one, or all of the instrument's. */
export const domainsFor = (tool, focus) => {
  const one = tool.domains.find(d => d.id === focus?.domain);
  return one ? [one] : tool.domains;
};

/**
 * Keeps a model's evidence only where it can be checked: a known domain, and a
 * quote found verbatim on the page it names (or in the abstract, when that is
 * all there was). A quote on a different page than claimed is dropped too,
 * because the page is what the person will open to check it.
 */
export function keepEvidence(reply, src, domains) {
  const byId = new Map(domains.map(d => [d.id, d]));
  const seen = new Set();
  const out = [];
  for (const e of reply?.evidence || []) {
    const d = byId.get(String(e?.domain || '').toLowerCase());
    const quote = String(e?.quote || '').trim();
    if (!d || !quote) continue;
    let page = null;
    if (src.pages.length) {
      page = Number(e.page);
      const pg = src.pages.find(p => p.page === page);
      if (!pg || !quoteIn(quote, pg.text)) continue;
    } else if (!quoteIn(quote, src.abstract)) continue;
    const key = `${d.id}|${quote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain: d, quote: quote.slice(0, 600), page, bears: String(e.bears || '').trim().slice(0, 300) });
  }
  return out;
}

/**
 * Whether a model's sentence states a risk-of-bias level ("low risk", "risk of
 * bias was high", "some concerns"). Such text is a judgement, which is the
 * person's to make, so it is never shown as a model's finding. Levels as plain
 * words ("high dropout") are left alone; only their use as a verdict counts.
 */
export function namesLevel(text, levels) {
  const alt = levels.filter(l => !/^no information$|^not applicable$/i.test(l))
    .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!alt) return false;
  return new RegExp(`\\b(${alt})\\s+(risk|concerns?)\\b|\\brisk(\\s+of\\s+bias)?\\s+(is|was|as|of|judged|rated)\\s+(${alt})\\b|\\bsome concerns\\b`, 'i').test(String(text || ''));
}

// The person's own level may be named in their rationale; only another may not.
const ownLevelOut = (text, level) =>
  String(text).replace(new RegExp(String(level).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');

/** Adds one note to a study, unless the same text is already there. */
function addNote(paperId, { kind, text, page, model }) {
  if ((get().notes || []).some(n => n.paper === paperId && n.text === text)) return false;
  update(s => {
    s.notes = [...(s.notes || []), {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      paper: paperId, kind, text, page: page ?? '', rects: null,
      // Found by a model; the quote itself was matched against the source, the
      // domain it was filed under was not.
      extractor: `model:${model || 'unknown'}`, verification: 'unverified',
      at: new Date().toISOString(),
    }];
    return s;
  });
  return true;
}

const whereOf = (paper, page) => ({ paperId: paper.id, locator: page ? { page } : null,
  label: page ? `${paper.label} · p. ${page}` : `${paper.label} · abstract` });

const focusedStudy = ctx => ctx?.focus?.kind === 'study' && ctx.focus.paperId;

const proposeEvidence = durableAction('appraisal-evidence', ({ paperId, text, page, model, domain }) => {
  return addNote(paperId, { kind: 'quote', text, page: page, model: model })
    ? `Added to ${domain} support` : 'Already in notes';
});

const proposeRationale = durableAction('appraisal-rationale', ({ paperId, toolId, domainId, domain, judgement, text, page, model }) => {
  // A rationale explains one judgement; if the person has since
  // changed it, this sentence no longer belongs to it.
  const now = judgements(get(), paperId, appraisalTool(toolId, get()))[domainId];
  if (now !== judgement) throw new Error(`${domain} is now ${now || 'unjudged'}`);

  return addNote(paperId, { kind: 'comment', text, page: page, model: model })
    ? `Added to ${domain} support` : 'Already in notes';
});

register('appraisal', [
  {
    id: 'rob-evidence',
    label: 'Find risk-of-bias evidence',
    icon: 'appraisal',
    task: 'appraise',
    // The study's abstract, or its pages when there is a PDF, are in the request.
    brief: { record: false, criteria: false },
    when: (s, ctx) => Boolean(focusedStudy(ctx) && paperOf(s, ctx.focus.paperId)),
    async run({ cfg, signal, brief, focus, selection, document, progress }) {
      const s = get();
      const paper = paperOf(s, focus.paperId);
      if (!paper) throw new Error('The study is no longer in the project');
      const tool = toolOf(s);
      const domains = domainsFor(tool, focus);
      // Text selected in this study's open document narrows the search to it,
      // filed under the page the selection is on, which need not be the page
      // the reader counts as current.
      const selPage = document?.selectionPage ?? document?.page;
      const narrowed = selection && document?.paperId === paper.id && selPage;
      if (!narrowed) progress('Reading the full text');
      const src = narrowed
        ? { pages: [{ page: selPage, text: selection }], abstract: '', note: `Selected text on p. ${selPage}` }
        : await sourceOf(paper, signal);
      if (!src.pages.length && !src.abstract) {
        return { title: `${paper.label}: no text`, note: 'No PDF and no abstract', items: [] };
      }
      progress(`Asking about ${domains.length === 1 ? domains[0].short : `${domains.length} domains`}`);
      const out = await complete(cfg, P.messagesOf(P.appraisalEvidence, { brief, tool, domains, study: paper.label, source: sourceText(src) }),
        { prompt: P.appraisalEvidence, signal, temperature: 0, json: true });
      const kept = keepEvidence(jsonOf(out), src, domains)
        .map(e => (namesLevel(e.bears, tool.judgements) ? { ...e, bears: '' } : e));
      return {
        prompt: promptRef(P.appraisalEvidence),
        title: `${paper.label}: ${tool.name} evidence`,
        note: [src.note, kept.length ? '' : 'No passage found that could be checked against the text'].filter(Boolean).join(' · '),
        items: kept.map(e => ({
          label: `${e.domain.short} ${e.domain.label}`,
          detail: e.bears,
          quote: e.quote,
          where: whereOf(paper, e.page),
          acceptLabel: 'Add to notes',
          ...proposeEvidence({ paperId: paper.id, text: `${tool.name} ${e.domain.short}: "${e.quote}"`, page: e.page, model: cfg.model, domain: e.domain.short }),
        })),
      };
    },
  },
  {
    id: 'rob-rationale',
    label: 'Draft domain rationale',
    icon: 'appraisal',
    task: 'appraise',
    // Only a judgement the person has already made gets a rationale; the
    // action has nothing to explain before that.
    // The study's abstract, or its pages when there is a PDF, are in the request.
    brief: { record: false, criteria: false },
    when: (s, ctx) => Boolean(focusedStudy(ctx) &&
      Object.keys(judgements(s, ctx.focus.paperId, toolOf(s))).some(k => toolOf(s).domains.some(d => d.id === k))),
    async run({ cfg, signal, brief, focus, progress }) {
      const s = get();
      const paper = paperOf(s, focus.paperId);
      if (!paper) throw new Error('The study is no longer in the project');
      const tool = toolOf(s);
      const made = { ...judgements(s, paper.id, tool) };
      const domains = domainsFor(tool, focus).filter(d => made[d.id]);
      if (!domains.length) return { title: `${paper.label}: no judgement`, note: 'No judgement in the focused domain', items: [] };
      progress('Reading the full text');
      const src = await sourceOf(paper, signal);
      // Quotes already filed for this study are the first evidence to cite.
      const filed = (s.notes || []).filter(n => n.paper === paper.id && n.kind === 'quote');
      const out = await complete(cfg, P.messagesOf(P.appraisalRationale, { brief, tool, study: paper.label, source: sourceText(src),
        judgements: domains.map(d => `${d.id} ${d.label}: ${made[d.id]}`).join('\n'),
        filed: filed.length ? filed.map(n => `p. ${n.page || 'abstract'}: ${n.text}`).join('\n').slice(0, 6000) : '' }),
      { prompt: P.appraisalRationale, signal, temperature: 0, json: true });
      const reply = jsonOf(out);
      // A rationale is held to the same test as evidence: its quote must be on its page.
      const kept = keepEvidence({ evidence: (reply.rationales || []).map(r => ({ ...r, bears: r.sentence })) }, src, domains)
        .filter(e => e.bears && !namesLevel(ownLevelOut(e.bears, made[e.domain.id]), tool.judgements));
      return {
        prompt: promptRef(P.appraisalRationale),
        title: `${paper.label}: ${tool.name} rationale`,
        note: [src.note, kept.length ? '' : 'No rationale rested on a passage found in the text'].filter(Boolean).join(' · '),
        items: kept.map(e => ({
          label: `${e.domain.short} ${made[e.domain.id]}`,
          detail: e.bears,
          quote: e.quote,
          where: whereOf(paper, e.page),
          acceptLabel: 'Add to notes',
          ...proposeRationale({ paperId: paper.id, toolId: tool.id, domainId: e.domain.id, domain: e.domain.short, judgement: made[e.domain.id], text: `${tool.name} ${e.domain.short} (${made[e.domain.id]}): ${e.bears}`, page: e.page, model: cfg.model }),
        })),
      };
    },
  },
]);

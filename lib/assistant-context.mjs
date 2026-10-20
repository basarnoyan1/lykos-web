// A fresh, bounded snapshot for each question. View selection is transient;
// scientific facts always come from the current project state.
import { projectIndex } from './project-index.mjs';
import { projectOverview, searchProject } from './project-memory.mjs';
import { nextResearchActions } from './research-workflow.mjs';
import { clipAbstract } from './text-clip.mjs';
import { helpFor, wantsHelp } from './assistant-help.mjs';

const clip = (v, n = 500) => String(v ?? '').slice(0, n);
const author = a => clip(typeof a === 'string' ? a : a?.name || [a?.given, a?.family].filter(Boolean).join(' '), 100);

export function resolveChatFocus(scope, focus) {
  if (!scope?.paper_id) return focus;
  if (focus?.paper_id === scope.paper_id && !focus.record)
    return scope.kind === 'cell' ? { ...focus, column_id: scope.column_id } : focus;
  return { view: 'thread scope', paper_id: scope.paper_id,
    ...(scope.kind === 'cell' ? { column_id: scope.column_id } : {}) };
}

export function focusSnapshot(state, focus, { depth = 'full' } = {}) {
  if (!focus) return null;
  const out = { view: clip(focus.view, 40) };
  if (focus.file) out.open_file = { name: clip(focus.file.name, 240), path: clip(focus.file.path, 600) };
  if (focus.page) out.reader_page = focus.page;
  if (focus.selected_text) out.selected_text = clip(focus.selected_text, 1000);
  if (focus.column_id) out.column_id = clip(focus.column_id, 100);
  const index=focus.paper_id?projectIndex(state):null,paper=index?.papers.get(focus.paper_id);
  if (!paper && focus.record) {
    const r = focus.record;
    out.search_result = { title: clip(r.title, 400), authors: (r.authors || []).slice(0, 8).map(author),
      year: r.year || null, journal: clip(r.journal, 180), doi: clip(r.doi, 100),
      language: clip(r.language || r.lang, 80) || null, abstract: depth === 'full' ? clipAbstract(r.abstract, 1500) : '',
      source: clip(r.source, 100), in_library: false };
  }
  if (!paper) return Object.keys(out).length > 1 ? out : null;
  out.paper = {
    id: paper.id, label: clip(paper.label, 180), title: clip(paper.title, 400),
    authors: (paper.authors || []).slice(0, 8).map(author),
    year: paper.year || null, journal: clip(paper.journal, 180),
    doi: clip(paper.doi, 100), language: clip(paper.language || paper.lang, 80) || null,
    abstract: depth === 'full' ? clipAbstract(paper.abstract, 1500) : '', pdf_attached: Boolean(paper.pdf),
    pdf_name: clip(paper.pdfName, 180),
  };
  if (depth !== 'full') {
    // The item is named and its decision given; what else it holds is one tool call away.
    out.screening = state.screening?.[paper.id]?.decision || null;
    out.full_text_decision = state.fulltext?.[paper.id]?.decision || null;
    return out;
  }
  out.screening = state.screening?.[paper.id] || null;
  out.full_text_decision = state.fulltext?.[paper.id] || null;
  const prefix = `${paper.id}:`;
  // Asked about one cell, its own value comes first and only a few of the study's other cells follow; otherwise the first eighteen.
  const allCells=index.values.get(paper.id)||[];
  const focusedKey=focus.column_id?`${prefix}${focus.column_id}`:null;
  const focusedCell=focusedKey&&allCells.find(([key])=>key===focusedKey);
  const cellsOf=focusedCell?[focusedCell,...allCells.filter(([key])=>key!==focusedKey).slice(0,7)]:allCells;
  out.accepted_cells = cellsOf.slice(0, focus.column_id ? 8 : 18)
    .map(([k, v]) => {
      const evidence = (v.evidence || []).filter(e => e.kind === 'text').slice(0, 2).map(e => ({ doc_id: e.doc_id, page: e.page, quote: clip(e.quote, 240) }));
      return { column: k.slice(prefix.length), value: clip(v.reported_value, 300),
        ...(v.availability && v.availability !== 'present' ? { availability: v.availability } : {}), ...(evidence.length ? { evidence } : {}) };
    });
  out.pending_proposals = (index.proposals.get(paper.id)||[]).slice(0,12)
    .map(([k, v]) => ({ column: k.slice(prefix.length), value: clip(v.value, 200), status: 'unaccepted proposal' }));
  out.notes = (index.notes.get(paper.id)||[]).slice(-8)
    .map(n => ({ page: n.page, kind: n.kind, text: clip(n.text, 400) }));
  return out;
}

// Fields that say nothing (nulls, empty text, empty lists) cost tokens on
// every turn and are dropped; so are the overview's zero counters, except the
// record count, which says whether the project is empty.
const compact = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) =>
  v != null && v !== '' && !(Array.isArray(v) && !v.length)));
const compactOverview = o => Object.fromEntries(Object.entries(compact(o)).filter(([k, v]) => v !== 0 || k === 'records'));

// What the person attached to the question (lib/chat-attach.mjs attachedText) ends the view description, under this line; it is kept apart from
// the page's own text so the page's clipping never cuts it. test/chat-attach.test.mjs holds the line equal to chat-attach.mjs ATTACHED_HEAD.
const ATTACHED = 'Attached by the person for this question';
export function splitAttached(viewContext) {
  const text = String(viewContext || ''), at = text.startsWith(ATTACHED) ? 0 : text.indexOf(`\n\n${ATTACHED}`);
  if (at < 0) return { screen: text, attached: '' };
  return at === 0 ? { screen: '', attached: text } : { screen: text.slice(0, at), attached: text.slice(at + 2) };
}

// The view description the app sends (lib/aid.mjs describe) opens with the
// project brief, which the chat already carries in its stable prefix, and it
// repeats the focused record in full. Keep what is specific to the screen:
// the view, the item in focus, the focused text and the selection.
const HEADS = /\n\n(?=Open view:|In focus \(|Focused text:|Focused record:|Document open beside the view:|Selected text:)/;
export function screenContext(viewContext, { paper = null, selected = '' } = {}) {
  let text = String(viewContext || '');
  if (/^Review: /.test(text)) { const at = text.search(/\n\nOpen view:/); text = at >= 0 ? text.slice(at + 2) : ''; }
  return text.split(HEADS).filter(part => {
    if (paper && part.startsWith('Focused record:') && part.includes(`Study: ${paper.label || ''}`)) return false;
    if (selected && part.startsWith('Selected text:') && part.includes(selected.slice(0, 200))) return false;
    return part.trim();
  }).map(part => /^(Focused text|Selected text|Focused record):/.test(part) ? clip(part, 2400) : part).join('\n\n');
}

// Whether the question is about the item in focus: a thread scoped to a paper or
// cell, a selection or open file, a word that points at what is on screen
// ("this", "it", "selected"; Turkish "bu", "şu"), or the item named (its label,
// DOI, or two words of its title). A question about the whole project sends the
// item's name and decision only.
const POINTS = /\b(this|that|these|those|it|its|here|current|currently|selected|highlighted|open|above|below|bu|şu|bunu|şunu|bunun)\b/i;
const NEXT = /\b(next|to-?do|what now|left|remaining|progress|status|priorit\w*|start|begin|get started|stuck|help|what can you|what should)\b/i;
export function focusDepth(state, query, { focus = null, scopePaperId = null } = {}) {
  if (!focus) return 'full';
  if (scopePaperId || focus.selected_text || focus.file || focus.column_id) return 'full';
  const q = String(query || '');
  if (POINTS.test(q)) return 'full';
  const paper = (state.papers || []).find(p => p.id === focus.paper_id);
  const rec = paper || focus.record;
  if (!rec) return 'full';
  const low = q.toLowerCase();
  if ((rec.label && low.includes(String(rec.label).toLowerCase())) || (rec.doi && low.includes(String(rec.doi).toLowerCase()))) return 'full';
  const title = String(rec.title || '').toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || [];
  if (title.filter(w => low.includes(w)).length >= 2) return 'full';
  return 'brief';
}

/**
 * The per-turn part of a chat request: what is on screen and what in the
 * project matches the question. `brief` is the project brief already sent
 * in the stable prefix; matches it already contains are not repeated.
 */
export function chatContext(state, query, { focus = null, scopePaperId = null, viewContext: told = '', brief = '' } = {}) {
  const { screen: viewContext, attached } = splitAttached(told);
  const depth = focusDepth(state, query, { focus, scopePaperId });
  const focused = focusSnapshot(state, focus, { depth });
  const targetId = scopePaperId || focused?.paper?.id || null;
  const focusPaper = focused?.paper?.id || null;
  const seen = new Set();
  // Rows already present in the focus snapshot or the brief, or listed twice.
  const fresh = m => {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) return false; seen.add(key);
    if (focusPaper && m.paper_id === focusPaper && ['paper', 'accepted_cell', 'note', 'screening_decision'].includes(m.kind)) return false;
    if (brief && m.kind==='protocol') return false;
    if (brief.includes('Eligibility criteria:') && m.kind==='criterion') return false;
    return true;
  };
  const row = m => compact({ ...m, text: clip(m.text, 600) });
  const matches = searchProject(state, query, { paperId: targetId, limit: 10 }).filter(fresh).slice(0, 4).map(row);
  const otherMatches = targetId ? searchProject(state, query, { limit: 12 }).filter(fresh).slice(0, 2).map(row) : [];
  const payload = compact({
    overview: compactOverview(projectOverview(state)),
    next: NEXT.test(String(query || '')) ? nextResearchActions(state, { limit: 3 }).map(({ kind, ...a }) => a) : [],
    help: wantsHelp(query) ? helpFor(focus?.view) : '',
    focus: focused && compact({ ...focused, paper: focused.paper && compact(focused.paper) }),
    attached: clip(attached, 13000),   // what the person attached to this question (lib/chat-attach.mjs): bounded where it is made, kept whole here
    on_screen: depth === 'full' ? clip(screenContext(viewContext, { paper: focused?.paper, selected: focused?.selected_text }), 4000)
      : clip(screenContext(viewContext, { paper: focused?.paper, selected: focused?.selected_text }).split('\n\n').filter(x => /^(Open view|In focus)/.test(x)).join('\n'), 400),
    matches,
    other_matches: otherMatches,
  });
  const withinBudget = () => JSON.stringify(payload).length <= 10000 + (payload.attached?.length || 0);
  for (const list of [payload.other_matches, payload.matches, payload.focus?.accepted_cells,
    payload.focus?.pending_proposals, payload.focus?.notes, payload.next]) {
    while (list?.length && !withinBudget()) list.pop();
  }
  if (!withinBudget() && payload.focus?.paper) payload.focus.paper.abstract = clip(payload.focus.paper.abstract, 500);
  if (!withinBudget()) payload.on_screen = clip(payload.on_screen, 1500);
  if (!withinBudget()) return JSON.stringify({ overview: payload.overview, ...(payload.attached ? { attached: payload.attached } : {}),
    focus: { view: focus?.view, paper: payload.focus?.paper ? {
      id: payload.focus.paper.id, label: payload.focus.paper.label, title: payload.focus.paper.title,
      pdf_attached: payload.focus.paper.pdf_attached } : null }, truncated: true });
  return JSON.stringify(payload);
}

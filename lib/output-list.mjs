// The list page of Tables and figures (views/outputs.mjs): the filter field's match and the assistant's answers as one row per question.
// Pure, so the merge and the match are tested without a page.
import { foldSearch } from './search-ranking.mjs';

/**
 * The filter field's test: every word typed is found in the row's texts, whatever the case or the accents (ı, İ, ş, é fold to i, s, e).
 * Returns null for an empty query (nothing is filtered), else `(...texts) => boolean`.
 */
export function matcher(query) {
  const terms = foldSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  return (...texts) => { const hay = foldSearch(texts.filter(x => x != null && x !== '').join(' ')); return terms.every(t => hay.includes(t)); };
}

// What an answer holds, without when it was computed: two answers with the same signature show the same thing.
function signature(block = {}) {
  const { at, ...provenance } = block.provenance || {};
  return JSON.stringify({ ...block, provenance });
}

/**
 * The assistant's answers (lib/assistant-work.mjs assistantWork, newest first) as rows: answers with the same title are one row when they
 * answer one question (the same turn of one conversation: the assistant ran several queries for it) or hold the same content. A row is the
 * newest answer's fields plus `count`, `ids` and `answers` (its answers, oldest first, the order they were given in); rows stay newest first.
 */
export function mergeAnswers(work) {
  const rows = [], byKey = new Map();
  for (const w of work) {
    const r = w.record || {}, title = String(w.title || '');
    const turn = `${title}\u0000turn\u0000${r.threadId || ''}\u0000${r.turn ?? r.messageId ?? w.id}`, same = `${title}\u0000same\u0000${signature(r.block)}`;
    let row = byKey.get(turn) || byKey.get(same);
    if (!row) { row = { ...w, members: [] }; rows.push(row); }
    row.members.push(w); byKey.set(turn, row); byKey.set(same, row);
  }
  return rows.map(({ members, ...row }) => ({ ...row, count: members.length, ids: members.map(m => m.id), answers: [...members].reverse() }));
}

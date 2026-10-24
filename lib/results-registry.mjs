// The registry of Tables and figures (plan §2, "One registry", 2026-10-23): every kept thing is one row of Results, with where it came from,
// its versions and where it is used. This module holds the parts that are not drawings: the chat's answers filed as rows, and the words of
// a row's origin and uses.
//
// The chat's answers. A conversation's durable records (lib/research-ledger.mjs) were listed under Show: From chats; they are now rows of
// Results whose origin is a chat. `s.results` holds them: `[{ id: 'chat:<first record id>', origin: 'chat', title, threadId, versions: [{ n, at,
// author, message, summary, recordId, threadId, messageId, turn, block }] }]`, one row per question (answers to one question, or holding the
// same thing, are versions of one row, as lib/output-list.mjs mergeAnswers grouped them). Filing a record leaves the ledger a stub in its place
// (`{ id, threadId, messageId, turn, blockIndex, at, filed }`): the ledger keeps the conversation, the row keeps the figure, and
// researchRecords reads the block back from the row, so the assistant's own reads see every record as before. `fileChatResults` is the
// migration and the filing of later answers alike: idempotent, nothing lost (a test holds every record's block to its row's).
import { researchRecords, ensureResearchLedger, removeResearchRecord } from './research-ledger.mjs';
import { titleOf, kindOf } from './assistant-work.mjs';
import { useWords } from './app-items.mjs';

const listed = r => r.block?.type !== 'budget';   // a chat budget is the conversation's own bookkeeping
const signature = block => { const { at, ...provenance } = block?.provenance || {}; void at; return JSON.stringify({ ...block, provenance }); };
const keysOf = (title, v) => [`${title}\u0000turn\u0000${v.threadId || ''}\u0000${v.turn ?? v.messageId ?? v.recordId}`, `${title}\u0000same\u0000${signature(v.block)}`];

/** The chat's records not filed yet (the ledger's and those still only in a conversation), oldest first. */
export const unfiledRecords = s => researchRecords(s).filter(r => !r.filed && listed(r));

/** Files every record not filed yet as a row (or a version of the row that answers the same question). Returns how many it filed. Mutates `st`. */
export function fileChatResults(st) {
  const todo = unfiledRecords(st);
  if (!todo.length) return 0;
  st.results ||= [];
  const ledger = ensureResearchLedger(st), byKey = new Map();
  for (const row of st.results) if (row.origin === 'chat') for (const v of row.versions) for (const k of keysOf(row.title, v)) byKey.set(k, row);
  for (const r of todo) {
    const title = titleOf(st, r), v = { recordId: r.id, threadId: r.threadId, messageId: r.messageId, turn: r.turn, at: r.at || '', block: structuredClone(r.block) };
    const keys = keysOf(title, v);
    let row = keys.map(k => byKey.get(k)).find(Boolean);
    if (!row) { row = { id: `chat:${r.id}`, origin: 'chat', title, threadId: r.threadId, versions: [] }; st.results.push(row); }
    const n = (row.versions.at(-1)?.n || 0) + 1;
    row.versions.push({ n, at: v.at, author: 'Assistant', message: '', summary: n === 1 ? 'Answered' : 'Answered again', ...v });
    for (const k of keys) byKey.set(k, row);
    const stub = { id: r.id, threadId: r.threadId, messageId: r.messageId, turn: r.turn, blockIndex: r.blockIndex, at: r.at || null, filed: row.id };
    const i = ledger.records.findIndex(x => x.id === r.id);
    if (i >= 0) ledger.records[i] = stub; else ledger.records.push(stub);
  }
  return todo.length;
}

/**
 * The chat rows of Results, newest first: `{ id, title, kind, source, at, count, versions, record }`, `record` the newest answer as a ledger
 * record (`{ id, threadId, messageId, block }`). Records not filed yet are shown as they will be filed, without writing the state.
 */
export function chatRows(s) {
  let rows = (s.results || []).filter(r => r.origin === 'chat');
  if (unfiledRecords(s).length) {
    const shadow = { threads: s.threads, results: structuredClone(s.results || []), researchLedger: { ...(s.researchLedger || {}), records: [...(s.researchLedger?.records || [])] } };
    fileChatResults(shadow);
    rows = shadow.results.filter(r => r.origin === 'chat');
  }
  const threads = new Map((s.threads || []).map(t => [t.id, t]));
  return rows.filter(r => r.versions?.length).map(r => {
    const v = r.versions.at(-1);
    return { id: r.id, title: r.title, kind: kindOf(v.block), source: String(threads.get(r.threadId)?.title || 'Conversation').slice(0, 40), at: v.at || null, count: r.versions.length,
      versions: r.versions, record: { id: v.recordId, threadId: v.threadId, messageId: v.messageId, turn: v.turn, block: v.block } };
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/** Takes a chat row out of Results, and its answers out of the saved work (the conversation keeps them). Mutates `st`. */
export function removeChatResult(st, id) {
  fileChatResults(st);
  const row = (st.results || []).find(r => r.id === id);
  if (!row) return false;
  for (const v of row.versions) removeResearchRecord(st, v.recordId);
  st.results = st.results.filter(r => r.id !== id);
  return true;
}

// ---- words ------------------------------------------------------------------------------------------------------------------------------
const ORIGIN = { 'Data summary': 'the Data summary', chat: 'a chat' };
/** A row's origin in words: "From the Data summary", "From a chat: Design counts", "From Datasets: Cohort, 120 rows". */
export const originWords = (origin, detail = '') => `From ${ORIGIN[origin] || origin}${detail ? `: ${detail}` : ''}`;
/** Where a saved output came from, by its first version: Make on the Data summary, the chat, an MCP client, or this page. */
export function outputOrigin(entry) {
  const v = entry?.versions?.[0] || {};
  if (/data summary/i.test(v.message || '')) return 'Data summary';
  if (v.author === 'Assistant') return 'chat';
  if (v.author && !['You', 'Lykos'].includes(v.author)) return 'MCP';
  return '';
}
/** Where the paper uses the drawings of `keys` (lib/app-items.mjs placements), in words, each once. */
export const usesOf = (at, keys) => [...new Set(keys.flatMap(k => (at.get(k) || []).map(useWords)))];
/** The state of a kept result in words: its inputs as they are, changed since it was made, or kept before inputs were recorded. */
export const STATE_WORDS = { current: 'Current', stale: 'Data changed since made', untracked: '' };

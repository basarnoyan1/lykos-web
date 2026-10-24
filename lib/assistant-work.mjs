// The assistant's saved work as rows of Tables and figures ("From the assistant"): the durable records of the conversations
// (lib/research-ledger.mjs) named for what was asked, with their kind, the conversation they came from and when. A query result
// and a proposed output can become a saved output (outputSpecOf); the rest open as they were answered. A chat budget is the
// conversation's own bookkeeping and is not listed.
import { researchRecords } from './research-ledger.mjs';
import { newOutputId } from './output-spec.mjs';
import { parseWhere } from './project-query.mjs';

const GENERIC = /^(query result|proposed output|answer details|work checks|results?|table|comparison)$/i;
const clip = (t, n = 90) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const KIND = { table: 'Table', analysis: 'Analysis', survival: 'Kaplan–Meier', claims: 'Claim check', metrics: 'Summary', bars: 'Bar chart', plan: 'Plan' };

export function kindOf(block) {
  if (block.type === 'output') return block.spec?.kind === 'chart' ? 'Figure' : 'Table';
  if (block.type === 'artifact') { const k = String(block.artifact?.kind || 'document'); return k[0].toUpperCase() + k.slice(1); }
  return KIND[block.type] || 'Answer';
}

// What the person asked just before the answer that holds the record, when the conversation still has it.
function questionOf(state, r) {
  const messages = (state.threads || []).find(t => t.id === r.threadId)?.messages || [];
  const at = messages.findIndex(m => (m.id || '') === r.messageId);
  for (let i = (at < 0 ? messages.length : at) - 1; i >= 0; i--) if (messages[i].role === 'user' && String(messages[i].text || '').trim()) return messages[i].text;
  return '';
}
// A query's own words when nothing better is known: "Studies by Year".
function queryName(q) {
  if (!q?.from) return '';
  const from = String(q.from)[0].toUpperCase() + String(q.from).slice(1);
  return q.groupBy?.length ? `${from} by ${q.groupBy.join(' and ')}` : q.select?.length ? `${from}: ${q.select.slice(0, 3).join(', ')}` : from;
}

// A query in plain words, so a person can judge what was asked: "Included studies where Design contains RCT, counted by Year".
const FROM = { studies: 'studies', records: 'records', screening: 'screening decisions', searches: 'searches', appraisal: 'appraisal judgements', collections: 'collections', patients: 'patients', arms: 'study arms', values: 'extracted values' };
const OP = { '=': 'is', '==': 'is', '!=': 'is not', '~': 'contains', '!~': 'does not contain', in: 'is one of', 'not in': 'is not one of', empty: 'is empty', 'not empty': 'is not empty' };
const and = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
export function queryWords(q) {
  if (!q?.from) return '';
  const what = FROM[q.from] || String(q.from), scoped = q.from === 'studies' && q.scope !== 'all' ? `Included ${what}` : what[0].toUpperCase() + what.slice(1);
  let where = [];
  try { where = parseWhere(q.where).map(w => [w.col, OP[w.op] || w.op, ['empty', 'not empty'].includes(w.op) ? '' : Array.isArray(w.value) ? w.value.join(' or ') : w.value].filter(Boolean).join(' ')); } catch { where = q.where ? [String(q.where)] : []; }
  const parts = [scoped, q.collection ? `in ${q.collection}` : '', q.template && q.template !== 'default' ? `from ${q.template}` : '', where.length ? `where ${and(where)}` : '',
    q.groupBy?.length ? `counted by ${and([].concat(q.groupBy))}` : q.select?.length ? `showing ${and([].concat(q.select))}` : ''];
  return parts.filter(Boolean).join(' ');
}
/** How many rows a query answer has and how many it shows: { total, shown, partial }. A record from before the totals were kept counts its rows. */
export function rowsOf(block) {
  const shown = (block.rows || []).length, total = Number.isFinite(block.provenance?.total) ? block.provenance.total : shown;
  return { total, shown, partial: total > shown };
}
/** The line under a partial answer; nothing when the answer is complete. */
export const partialNote = ({ total, shown, partial }) => partial ? `Shows the first ${shown} of ${total} rows the assistant returned, not the whole set.` : '';

export function titleOf(state, r) {
  const b = r.block, own = b.artifact?.title || b.spec?.title || b.title || '';
  if (own && !GENERIC.test(own.trim())) return clip(own);
  return clip(questionOf(state, r)) || clip(queryName(b.provenance?.query)) || own || kindOf(b);
}

/** The spec a record would be saved as, or null when it is not a table or figure of the project's data. */
export function outputSpecOf(state, r) {
  const b = r.block;
  if (b.type === 'output' && b.spec?.query) return { ...structuredClone(b.spec), id: newOutputId() };
  const q = b.provenance?.query;
  if (b.type === 'table' && q?.from) {
    const { limit, offset, ...query } = structuredClone(q);
    return { id: newOutputId(), kind: 'table', title: titleOf(state, r), query };
  }
  return null;
}

export const questionFor = (state, r) => clip(questionOf(state, r), 400);
/** Newest first: { id, title, kind, source, at, record }. */
export function assistantWork(state) {
  const threads = new Map((state.threads || []).map(t => [t.id, t]));
  return researchRecords(state).filter(r => r.block.type !== 'budget').reverse().map(r => ({
    id: r.id, title: titleOf(state, r), kind: kindOf(r.block), source: clip(threads.get(r.threadId)?.title || 'Conversation', 40), at: r.at || null, record: r,
  }));
}

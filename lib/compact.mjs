// Compaction: when a run's transcript nears the model's window, the middle —
// older tool exchanges — is folded into one summary. The opening message
// (codebook and paper text) and the latest exchanges stay verbatim, and the run
// log keeps every original step, so the audit is complete after compaction.
import { RUN_SUMMARY } from './prompts.mjs';
const IMAGE_TOKENS = 1500;

export function estimateTokens(messages) {
  let chars = 0, images = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) for (const p of m.content) { if (p.type === 'image_url') images++; else chars += JSON.stringify(p).length; }
    else chars += JSON.stringify(m).length;
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS;
}

export const shouldCompact = (messages, contextLength, ratio = 0.6) => estimateTokens(messages) > (contextLength || 128000) * ratio;

export function splitForCompaction(messages, keepTail = 8) {
  let h = 0;
  while (h < messages.length && messages[h].role === 'system') h++;
  if (h < messages.length && messages[h].role === 'user') h++;
  const head = messages.slice(0, h);
  let t = Math.max(h, messages.length - keepTail);
  while (t > h && messages[t].role !== 'assistant') t--;
  return { head, middle: messages.slice(h, t), tail: messages.slice(t) };
}

export async function compact(messages, summarise, keepTail = 8) {
  const { head, middle, tail } = splitForCompaction(messages, keepTail);
  if (!middle.length) return { messages, summary: '' };
  const summary = String(await summarise(middle) || '').trim();
  return { messages: [...head, { role: 'user', content: `Summary of earlier work:\n${summary}` }, ...tail], summary };
}

/** The prompt the compaction model answers. */
export const SUMMARY_PROMPT = RUN_SUMMARY.text;

/**
 * Older tool results, shortened. A transcript carries every tool result of the
 * turn in each later request; a page of a PDF read in step 2 is paid for again
 * in steps 3 to 12. When the results older than the latest `keep` together
 * exceed `minChars`, each of those longer than `head` characters is replaced by
 * its first `head` characters and a note saying what it was and that the call
 * can be made again; the model's own notes and the run log keep what it did
 * with them. Done in one sweep, not one result per step, so the request's
 * opening stays identical between sweeps (a provider's prefix cache reads it).
 * Mutates `messages`; returns the tool_call ids it shortened.
 */
export function elideToolResults(messages, { keep = 8, minChars = 120000, head = 4000 } = {}) {
  const tools = messages.map((m, i) => (m.role === 'tool' && typeof m.content === 'string' ? i : -1)).filter(i => i >= 0);
  const old = tools.slice(0, Math.max(0, tools.length - keep));
  const fat = old.filter(i => messages[i].content.length > head + 200 && !messages[i].content.startsWith('[earlier result'));
  if (fat.reduce((n, i) => n + messages[i].content.length, 0) < minChars) return [];
  const ids = [];
  for (const i of fat) {
    const m = messages[i], call = messages.slice(0, i).reverse().find(x => x.tool_calls?.some(c => c.id === m.tool_call_id))?.tool_calls.find(c => c.id === m.tool_call_id);
    const what = call ? `${call.function?.name} ${String(call.function?.arguments || '').slice(0, 120)}` : 'a tool call';
    m.content = `[earlier result, shortened from ${m.content.length} characters: ${what}. Call it again if you need the rest.]\n${m.content.slice(0, head)}`;
    ids.push(m.tool_call_id);
  }
  return ids;
}

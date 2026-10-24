// Claude through Anthropic's own Messages API (plan §6.3, Claude API amendment of 2026-10-11).
//
// The app speaks Chat Completions inside (role/content messages, `tool_calls`,
// role "tool" results); this module turns that transcript into one Messages API
// request and turns the answer back, the way lib/chatgpt.mjs does for the
// Responses API. It holds no key and keeps no state: the caller passes the
// connection and a `send` that performs the request (in the desktop app the
// shell's `ai_request`, so the webview never contacts api.anthropic.com).
//
// What the request carries, and why:
// - Leading and later system messages become the top-level `system` blocks.
// - Prompt caching: a breakpoint on the last system block (tools and
//   instructions, the part every call of a batch or turn shares), on up to two
//   messages a caller flagged `cache: true`, and the request's automatic
//   breakpoint on the moving end of the conversation; four in all, the limit.
// - No temperature: the current Claude models refuse sampling parameters.
// - Thinking is left to the model (adaptive on the current models; Claude Opus
//   5.5 cannot switch it off). The effort control, when a person chose one,
//   goes in `output_config.effort`.
// - Forced tool choice is refused by the current models, so a tool call is
//   only ever `auto` or `none`; JSON answers are asked for by instruction,
//   because the app's JSON calls carry no schema to constrain to.
// - The answer is streamed (server-sent events) and read when it is complete:
//   the shell returns the whole body, as it does for ChatGPT.
// - The model's own blocks (thinking with its signature, tool calls) are kept
//   on the assistant message as `_responseItems` and sent back unchanged, so a
//   tool loop keeps its reasoning. If the app has shortened earlier turns since
//   (elided tool results), the API refuses those blocks; they are dropped once
//   and the request is sent again.
// - No server-side fallback to another model: a run stays on the model the
//   person chose (§6.5), so a refusal is reported, not rerouted.
import { inDesktop } from './native.mjs';

export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * The models offered before a key has listed its own, with Anthropic's list
 * prices in US dollars per million tokens (claude-api reference, models table
 * cached 2026-10-06). `cacheRead` is as published; a five-minute cache write is
 * 1.25 × input and a one-hour write 2 × input, for every model here. Claude
 * Haiku 5.5 has a second rate card for prompts over 100,000 tokens. A model not
 * in this table has no known price: its cost is recorded as unknown.
 */
export const CLAUDE_MODELS = Object.freeze([
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', context: 1000000, input: 10, output: 50, cacheRead: 0.25 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', context: 1000000, input: 4, output: 20, cacheRead: 0.20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', context: 1000000, input: 2, output: 10, cacheRead: 0.20 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', context: 1000000, input: 0.10, output: 0.50, cacheRead: 0.01,
    above: { tokens: 100000, input: 0.50, output: 2.50, cacheRead: 0.05 } },
].map(Object.freeze));
const KNOWN = new Map(CLAUDE_MODELS.map(m => [m.id, m]));

/** A catalogue row (the shape lib/ai.mjs keeps for every provider) for a model in the table. */
const rowOf = m => ({ id: m.id, label: m.label, context: m.context, promptPrice: m.input, completionPrice: m.output, tools: true, images: true, efforts: [...EFFORTS] });
export const claudeRows = () => CLAUDE_MODELS.map(rowOf);
export const claudeRow = id => KNOWN.has(id) ? rowOf(KNOWN.get(id)) : null;

/** The rows of GET /v1/models, priced from the table where the model is in it. */
export function claudeModelRows(data) {
  if (!Array.isArray(data?.data)) throw new Error('Anthropic did not return a model list.');
  return data.data.filter(m => typeof m?.id === 'string' && m.id).map(m => {
    const known = claudeRow(m.id), caps = m.capabilities || {};
    const efforts = EFFORTS.filter(e => caps.effort?.[e]?.supported === true);
    return { id: m.id, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : known?.label || m.id,
      context: Number.isFinite(m.max_input_tokens) ? m.max_input_tokens : known?.context ?? null,
      promptPrice: known?.promptPrice ?? null, completionPrice: known?.completionPrice ?? null, tools: known ? true : null,
      images: typeof caps.image_input?.supported === 'boolean' ? caps.image_input.supported : known?.images ?? null,
      ...(efforts.length ? { efforts } : known ? { efforts: known.efforts } : {}) };
  });
}

/** Dollars for one response at list price, or null when the model or a token count is unknown. */
export function claudeCost(model, u) {
  const m = KNOWN.get(model);
  if (!m || !u || !Number.isFinite(u.input_tokens) || !Number.isFinite(u.output_tokens)) return null;
  const read = u.cache_read_input_tokens || 0, write = u.cache_creation_input_tokens || 0;
  const hour = Math.min(write, u.cache_creation?.ephemeral_1h_input_tokens || 0);
  const card = m.above && u.input_tokens + read + write > m.above.tokens ? m.above : m;
  return (u.input_tokens * card.input + u.output_tokens * card.output + read * card.cacheRead
    + (write - hour) * card.input * 1.25 + hour * card.input * 2) / 1e6;
}

/**
 * The usage block as the app records it. Anthropic counts uncached input,
 * cache writes and cache reads separately; the app's input is their sum, as the
 * other providers report it. A cost from the table is marked as estimated.
 */
export function claudeUsage(model, u) {
  u = u && typeof u === 'object' ? u : {};
  const n = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const input = n(u.input_tokens), read = n(u.cache_read_input_tokens), write = n(u.cache_creation_input_tokens);
  const cost = claudeCost(model, u);
  return { prompt: input == null ? null : input + (read || 0) + (write || 0), completion: n(u.output_tokens), cached: read, cacheWrite: write,
    cost, ...(cost == null ? {} : { estimated: true }) };
}

/** Whether `base` (the connection's endpoint, Anthropic's own when empty) is api.anthropic.com. */
export const isAnthropicEndpoint = base => { try { return new URL(String(base || ANTHROPIC_BASE)).origin === 'https://api.anthropic.com'; } catch { return false; } };

/**
 * The workspace a key without a workspace of its own must name (the anthropic-workspace-id header), or '' when none is set, the
 * endpoint is not Anthropic's own (the id goes to no other host) or the value could not be a header.
 */
export const claudeWorkspace = cfg => {
  const id = String(cfg?.workspaceId || '').trim();
  return id && /^[\x21-\x7e]+$/.test(id) && isAnthropicEndpoint(cfg?.base) ? id : '';
};

/** Request headers. The key goes in x-api-key and nowhere else; the workspace id, when one is given, in anthropic-workspace-id. */
export function claudeHeaders(key, browser = !inDesktop(), workspace = '') {
  return { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}), ...(workspace ? { 'anthropic-workspace-id': workspace } : {}), 'anthropic-version': ANTHROPIC_VERSION,
    // A page outside the desktop shell calls the API itself; Anthropic asks such callers to say so.
    ...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}) };
}


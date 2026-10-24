// One Messages API request (lib/anthropic.mjs has what the request carries, and why). Kept apart so the shell loads it with the
// first Claude call, not at startup: lib/ai.mjs imports it on use (app/test/startup-graph.test.mjs).
import { ANTHROPIC_BASE, EFFORTS, claudeHeaders, claudeUsage, claudeWorkspace } from './anthropic.mjs';

// ---- the request ---------------------------------------------------------------
const REPLAYED = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use']);
const EPHEMERAL = Object.freeze({ type: 'ephemeral' });
const JSON_ONLY = 'Answer with the JSON value only: no prose before or after it and no code fences.';
const safeId = id => String(id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_');
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p?.type === 'text').map(p => p.text || '').join('\n') : c == null ? '' : String(c);
const argsOf = a => { try { const v = JSON.parse(a || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const providerItems = m => Array.isArray(m._responseItems) && m._responseItems.length && m._responseItems.every(b => REPLAYED.has(b?.type)) ? m._responseItems : null;

function mediaBlock(url) {
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''));
  if (data) return { type: data[1] === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
  if (/^https:\/\//i.test(String(url || ''))) return { type: 'image', source: { type: 'url', url } };
  throw new Error('Claude takes images as data or https addresses only.');
}
function blocksOf(content) {
  if (content == null) return [];
  if (!Array.isArray(content)) return String(content) ? [{ type: 'text', text: String(content) }] : [];
  return content.map(p => {
    if (p?.type === 'text') return p.text ? { type: 'text', text: p.text } : null;
    if (p?.type === 'image_url') return mediaBlock(p.image_url?.url);
    throw new Error(`Claude cannot take message content of type ${p?.type}.`);
  }).filter(Boolean);
}

/** The Messages API body for a Chat Completions transcript. Pure. */
export function claudeBody(model, messages, { tools = [], toolChoice = 'auto', json = false, maxTokens = 2000, effort = '', cacheTail } = {}) {
  const system = [], out = [], flagged = [];
  const push = (role, blocks) => {
    if (!blocks.length) return null;
    const last = out.at(-1);
    if (last?.role === role) last.content.push(...blocks); else out.push({ role, content: [...blocks] });
    return blocks.at(-1);
  };
  const used = new Set();
  for (const m of messages) {
    if (m.role === 'system') {
      const text = textOf(m.content);
      if (text) { const block = { type: 'text', text }; system.push(block); if (m.cache) flagged.push(block); }
      continue;
    }
    if (m.role === 'tool') {
      const content = Array.isArray(m.content) ? blocksOf(m.content) : String(m.content ?? '');
      const last = push('user', [{ type: 'tool_result', tool_use_id: safeId(m.tool_call_id), content }]);
      if (m.cache && last) flagged.push(last);
      continue;
    }
    if (m.role === 'assistant') {
      const items = providerItems(m);
      const blocks = items ? items.filter(b => b.type !== 'text' || b.text) : [
        ...(textOf(m.content) ? [{ type: 'text', text: textOf(m.content) }] : []),
        ...(m.tool_calls || []).map(c => ({ type: 'tool_use', id: safeId(c.id), name: c.function?.name, input: argsOf(c.function?.arguments) })),
      ];
      for (const b of blocks) if (b.type === 'tool_use') used.add(b.name);
      push('assistant', blocks);
      continue;
    }
    const last = push('user', blocksOf(m.content));
    if (m.cache && last) flagged.push(last);
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  if (!out.length) out.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  // Breakpoints: the stable prefix, then flagged messages. The automatic one on the moving end pays where the next request extends this
  // one (a conversation, or any call that carries tools). A one-shot call ends in content no later call repeats: there it is a write at 1.25 × input that is
  // never read, so it is left off and a flag on the last message is marked itself.
  const tail = cacheTail ?? (tools.length > 0 || out.some(m => m.role === 'assistant'));
  if (system.length) system.at(-1).cache_control = EPHEMERAL;
  const end = out.at(-1).content.at(-1);
  for (const block of flagged.filter(b => !(tail && b === end) && !b.cache_control).slice(0, tail ? 2 : 3)) block.cache_control = EPHEMERAL;
  if (json) system.push({ type: 'text', text: JSON_ONLY });
  const body = { model, max_tokens: maxTokens, stream: true, ...(tail ? { cache_control: EPHEMERAL } : {}), ...(system.length ? { system } : {}), messages: out };
  // A transcript that holds tool calls needs their definitions even when this turn may not call any.
  const defs = tools.filter(t => t?.type === 'function' && t.function?.name).map(t => ({ name: t.function.name, description: t.function.description || '',
    input_schema: { type: 'object', ...(t.function.parameters || {}) } }));
  for (const name of used) if (name && !defs.some(d => d.name === name)) defs.push({ name, description: 'Not available in this turn.', input_schema: { type: 'object', properties: {} } });
  if (defs.length) { body.tools = defs; body.tool_choice = { type: toolChoice === 'none' || !tools.length ? 'none' : 'auto' }; }
  if (effort && EFFORTS.includes(effort)) body.output_config = { effort };
  return body;
}

/** Removes the model's thinking blocks from replayed assistant turns, in place; whether any were there. */
export function dropThinking(messages) {
  let dropped = false;
  for (const m of messages) {
    const items = m.role === 'assistant' && providerItems(m);
    if (!items) continue;
    for (let i = items.length; i--;) if (items[i].type === 'thinking' || items[i].type === 'redacted_thinking') { items.splice(i, 1); dropped = true; }
  }
  return dropped;
}

// ---- the answer ----------------------------------------------------------------
/** An error in plain words. Nothing of the request (and so no key) is in it. */
export function claudeError(status, payload) {
  let data = payload;
  if (typeof payload === 'string') { try { data = JSON.parse(payload); } catch { data = null; } }
  const error = data?.error || (data?.type && data.type !== 'error' ? data : null) || {};
  const type = String(error.type || ''), detail = String(error.message || '').replace(/sk-ant-[\w-]+/g, 'sk-ant-…').slice(0, 1000);
  // A key made outside a workspace must say which one to use: that is a field in Settings, not a fault of the key.
  const workspace = /anthropic-workspace-id|not scoped to a workspace/i.test(detail);
  const text = workspace ? 'This API key is not scoped to a workspace. Enter the Workspace ID in Settings, Models.'
    : status === 401 || type === 'authentication_error' ? 'Claude did not accept the API key. Check the key in Settings, Models.'
    : status === 402 || type === 'billing_error' || /credit balance/i.test(detail) ? 'The Anthropic account has no credit left. Add credit in the Anthropic Console, then try again.'
    : status === 403 || type === 'permission_error' ? `This API key may not use this model or feature.${detail ? ` ${detail}` : ''}`
    : status === 404 || type === 'not_found_error' ? `Claude does not offer this model to this key. Choose another model in Settings, Models.${detail ? ` (${detail})` : ''}`
    : status === 413 || type === 'request_too_large' ? 'The request is too large for Claude. Send fewer pages or a shorter text.'
    : status === 429 || type === 'rate_limit_error' ? 'Claude’s rate limit was reached. Wait a minute, then try again.'
    : status === 529 || type === 'overloaded_error' ? 'Claude is overloaded at the moment. Try again in a few minutes.'
    : (status >= 500 || type === 'api_error') ? 'Claude had a server error. Try again shortly.'
    : `Claude could not accept the request: ${detail || `HTTP ${status}`}`;
  const err = new Error(text); err.status = status || null; err.code = workspace ? 'workspace_required' : type; err.detail = detail;
  // The kind lets Test connection speak the same classes as every other provider (lib/provider-error.mjs); the sentence stays Claude's own.
  err.kind = workspace ? 'workspace' : status === 401 || type === 'authentication_error' ? 'bad-key'
    : status === 402 || type === 'billing_error' || /credit balance/i.test(detail) ? 'quota' : status === 403 || type === 'permission_error' ? 'forbidden'
    : status === 404 || type === 'not_found_error' ? 'model-missing' : status === 429 || type === 'rate_limit_error' ? 'rate-limit'
    : status >= 500 || type === 'api_error' || type === 'overloaded_error' ? 'server' : 'rejected';
  return err;
}

/**
 * The message a stream describes, or the error it ends with. A stream that stops
 * before message_stop is not a message: its text may be partial and its tool
 * calls unfinished. A plain JSON body (a proxy that does not stream) is read too.
 */
export function parseClaudeStream(text) {
  const raw = String(text ?? '').trim();
  if (raw.startsWith('{')) {
    let data; try { data = JSON.parse(raw); } catch { throw new Error('Claude sent an unreadable answer.'); }
    if (data?.type === 'error') throw claudeError(0, data);
    if (data?.type !== 'message' || !Array.isArray(data.content)) throw new Error('Claude sent an unreadable answer.');
    return data;
  }
  let message = null, stopped = false;
  const blocks = [], partial = new Map();
  for (const frame of raw.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    let event; try { event = JSON.parse(data); } catch { throw new Error('Claude sent an unreadable stream event.'); }
    if (event.type === 'error') throw claudeError(0, event);
    if (event.type === 'message_start') { message = { ...event.message, content: [], usage: { ...(event.message?.usage || {}) } }; continue; }
    if (!message) continue;
    const block = blocks[event.index];
    if (event.type === 'content_block_start') {
      blocks[event.index] = { ...event.content_block };
      if (event.content_block?.type === 'tool_use') partial.set(event.index, '');
    } else if (event.type === 'content_block_delta' && block) {
      const d = event.delta || {};
      if (d.type === 'text_delta') block.text = (block.text || '') + (d.text || '');
      else if (d.type === 'thinking_delta') block.thinking = (block.thinking || '') + (d.thinking || '');
      else if (d.type === 'signature_delta') block.signature = (block.signature || '') + (d.signature || '');
      else if (d.type === 'input_json_delta') partial.set(event.index, (partial.get(event.index) || '') + (d.partial_json || ''));
    } else if (event.type === 'content_block_stop' && block?.type === 'tool_use') {
      const json = partial.get(event.index) || '';
      try { const input = json ? JSON.parse(json) : (block.input || {}); if (!input || typeof input !== 'object' || Array.isArray(input)) throw 0; block.input = input; }
      catch { block.input = {}; message.malformed = (message.malformed || 0) + 1; }
    } else if (event.type === 'message_delta') {
      Object.assign(message, Object.fromEntries(Object.entries(event.delta || {}).filter(([, v]) => v !== undefined)));
      for (const [k, v] of Object.entries(event.usage || {})) if (v != null) message.usage[k] = v;
    } else if (event.type === 'message_stop') stopped = true;
  }
  if (!message || !stopped) throw new Error('Claude’s answer stopped before it was complete; no tools were run.');
  message.content = blocks.filter(Boolean);
  return message;
}

/**
 * The answer as the app's tool loop reads it: a Chat Completions assistant
 * message, why it stopped, and usage. A refusal is an error with the usage it
 * cost; malformed tool input is an error unless the cap cut it off (then the
 * caller sees 'length' and runs nothing).
 */
export function claudeResult(message, model = '') {
  const content = Array.isArray(message?.content) ? message.content : [];
  const usage = claudeUsage(message?.model || model, message?.usage);
  if (message?.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    const err = new Error(`Claude declined this request${category ? ` (${category})` : ''}. No tools were run and nothing was changed.`);
    err.code = 'refusal'; err.usage = usage; throw err;
  }
  const finish = { tool_use: 'tool_calls', max_tokens: 'length', model_context_window_exceeded: 'length' }[message?.stop_reason] || 'stop';
  if (message?.malformed && finish !== 'length') { const err = new Error('Claude returned a malformed tool call; no tools were run.'); err.usage = usage; throw err; }
  const calls = content.filter(b => b.type === 'tool_use');
  return { response: message, finish, usage, thought: content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking'),
    message: { role: 'assistant', content: content.filter(b => b.type === 'text').map(b => b.text || '').join(''),
      ...(calls.length ? { tool_calls: calls.map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } })) } : {}),
      _responseItems: content } };
}

/**
 * One Messages API call. `send(url, init)` returns { ok, status, text() }:
 * lib/ai.mjs passes the shell's request behind the shared retry helper.
 */
export async function claudeComplete(cfg, messages, { send, signal, ...options } = {}) {
  const url = `${String(cfg.base || ANTHROPIC_BASE).replace(/\/+$/, '')}/messages`;
  const post = () => send(url, { method: 'POST', headers: claudeHeaders(cfg.key, undefined, claudeWorkspace(cfg)), signal, body: JSON.stringify(claudeBody(cfg.model, messages, options)) });
  let res = await post(), text = await res.text();
  // Shortened earlier turns invalidate the model's replayed reasoning: drop it and ask once more.
  if (res.status === 400 && /bound to a different conversation/i.test(text) && dropThinking(messages)) { res = await post(); text = await res.text(); }
  if (!res.ok) throw claudeError(res.status, text);
  return claudeResult(parseClaudeStream(text), cfg.model);
}

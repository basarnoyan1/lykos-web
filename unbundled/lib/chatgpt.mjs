import { EFFORTS, reasoningOptions } from './model-effort.mjs';
import { observeChatGptUsage } from './chatgpt-usage.mjs';
// Desktop OAuth metadata only. Native code owns every access/refresh/ID token.
import { inDesktop, chatGptAccountsNative, chatGptSigninNative, chatGptSignoutNative, chatGptRequestNative, cancelAiRequestNative, openUrlNative } from './native.mjs';
const accounts = new Map(), catalogs = new Map(), catalogTimes = new Map(), catalogRequests = new Map();
let catalogEpoch=0;
const invalidateCatalogs=()=>{catalogEpoch++;catalogs.clear();catalogTimes.clear();catalogRequests.clear();};
export const chatGptAccount = id => accounts.get(id) || null;
export const chatGptCatalog = id => catalogs.get(id) || [];
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
export const openChatGptUsage = () => inDesktop() ? openUrlNative(CHATGPT_USAGE_URL) : window.open(CHATGPT_USAGE_URL, '_blank', 'noopener,noreferrer');
export async function loadChatGptAccounts() {
  accounts.clear(); invalidateCatalogs();
  if (inDesktop()) for (const account of await chatGptAccountsNative()) accounts.set(account.id, account);
}
export async function signInChatGpt(id) {
  const account = await chatGptSigninNative(id); accounts.set(id, account); invalidateCatalogs(); return account;
}
export async function signOutChatGpt(id) {
  const result = await chatGptSignoutNative(id); accounts.delete(id); invalidateCatalogs(); return result;
}
async function request(id, body = null, signal) {
  if (!inDesktop()) throw new Error('ChatGPT sign-in requires the desktop app');
  if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
  const requestId = `cg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const pending = chatGptRequestNative(id, requestId, body);
  const res = signal ? await new Promise((resolve, reject) => {
    const abort = () => { cancelAiRequestNative(requestId).catch(() => {}); reject(new DOMException('Run stopped', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  }) : await pending;
  if (res.status < 200 || res.status >= 300) {
    let data; try { data = JSON.parse(res.text); } catch {}
    throw responseError(data?.error || { message: data?.detail || 'OpenAI request failed' }, res.status);
  }
  return res.text;
}
export function responseError(error, status) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const detail = String(error?.message || 'OpenAI could not complete this response').slice(0, 200);
  const advice = code === 'subscription_sharing_usage_limit_exceeded' ? 'Review your limit in ChatGPT Settings → Usage.'
    : code === 'subscription_sharing_user_not_eligible' ? 'ChatGPT plan access is unavailable for this account or workspace.'
    : ['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'].includes(code) ? 'Try again later; your connection is retained.'
    : status === 401 ? 'Sign in again in Settings → Models.' : '';
  const err = new Error(`ChatGPT${status ? ` HTTP ${status}` : ''}${code ? ` (${code})` : ''}: ${detail}${advice ? ` ${advice}` : ''}`);
  err.code = code; err.status = status || null; return err;
}
export function parseChatGptModels(data) {
  if (!Array.isArray(data?.models)) throw new Error('OpenAI did not return a ChatGPT model catalog');
  return data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({
    id: m.slug, label: m.display_name || m.slug, context: Number.isFinite(m.context_length) ? m.context_length : null,
    promptPrice: null, completionPrice: null, tools: null, images: null,
    ...(Array.isArray(m.supported_reasoning_levels) ? { efforts: EFFORTS.filter(e => m.supported_reasoning_levels.some(level => (typeof level === 'string' ? level : level.effort) === e)) } : {}),
  }));
}
export async function listChatGptModels(id, { signal, force = true } = {}) {
  if (!force && catalogs.has(id) && Date.now() - (catalogTimes.get(id) || 0) < 300000) return catalogs.get(id);
  if (!catalogRequests.has(id)) {
    const epoch=catalogEpoch;
    const pending = request(id).then(text => {
      if(epoch!==catalogEpoch)throw new Error('ChatGPT connection changed; reopen the model picker.');
      const rows = parseChatGptModels(JSON.parse(text)); catalogs.set(id, rows); catalogTimes.set(id, Date.now()); return rows;
    }).finally(() => { if (catalogRequests.get(id) === pending) catalogRequests.delete(id); });
    catalogRequests.set(id, pending);
  }
  if (signal?.aborted) throw new DOMException('Run stopped', 'AbortError');
  if (!signal) return catalogRequests.get(id);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Run stopped', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    catalogRequests.get(id).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}
/** Full history for store=false. System instructions become developer messages. */
export function responsesBody(model, messages, { tools = [], toolChoice = 'auto', json = false, reasoning = null } = {}) {
  const input = [];
  const contentParts = (parts, role = 'user') => parts.map(p => {
    if (p.type === 'text') return { type: role === 'assistant' ? 'output_text' : 'input_text', text: p.text };
    if (p.type === 'image_url') return { type: 'input_image', image_url: p.image_url.url, detail: p.image_url.detail || 'auto' };
    throw new Error(`Unsupported ChatGPT message content: ${p.type}`);
  });
  for (const m of messages) {
    if (m.role === 'tool') { input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: Array.isArray(m.content) ? contentParts(m.content) : String(m.content ?? '') }); continue; }
    if (m._responseItems?.length) { input.push(...m._responseItems); continue; }
    if (m.content) {
      const role = m.role === 'system' ? 'developer' : m.role;
      const content = Array.isArray(m.content) ? contentParts(m.content, role) : String(m.content);
      input.push({ role, content });
    }
    for (const call of m.tool_calls || []) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments, namespace: 'lykos' });
  }
  const body = { model, input, store: false, stream: true, include: ['reasoning.encrypted_content'] };
  if (tools.length) {
    body.tools = [{ type: 'namespace', name: 'lykos', description: 'Research tools in the active Lykos project.', tools: tools.map(t => {
      if (t.type !== 'function' || !t.function) throw new Error('ChatGPT supports Lykos function tools only');
      return { type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false };
    }) }];
    body.tool_choice = toolChoice;
  }
  if (reasoning) body.reasoning = reasoning;
  if (json) body.text = { format: { type: 'json_object' } };
  return body;
}
/** A delta alone is never success: limits and errors may arrive after text. */
export function parseResponsesStream(text) {
  let completed = null;
  const items = new Map(), parts = new Map();
  for (const frame of String(text).replace(/\r\n/g, '\n').split(/\n\n/)) {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    let event; try { event = JSON.parse(data); } catch { throw new Error('Invalid ChatGPT stream event'); }
    if (event.type === 'response.output_item.done' && event.item) items.set(event.output_index ?? items.size, event.item);
    if (['response.output_text.delta','response.output_text.done','response.refusal.delta','response.refusal.done'].includes(event.type)) {
      const index=event.output_index ?? 0, contentIndex=event.content_index ?? 0, key=`${index}:${contentIndex}`, refusal=event.type.includes('refusal');
      const old=parts.get(key)?.text || '';
      parts.set(key,{index,contentIndex,type:refusal?'refusal':'output_text',text:event.type.endsWith('.done') ? String(event.text ?? event.refusal ?? old) : old+String(event.delta ?? '')});
    }
    if (event.type === 'error') throw responseError(event.error || event);
    if (event.type === 'response.failed') throw responseError(event.response?.error);
    if (event.type === 'response.incomplete') throw new Error(`ChatGPT response incomplete: ${event.response?.incomplete_details?.reason || 'no completed output'}`);
    if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed') throw new Error('ChatGPT response was not completed');
      completed = event.response;
    }
  }
  if (!completed) throw new Error('ChatGPT stream ended before response.completed; no tools were run');
  // Some terminal envelopes omit output already delivered by stream events.
  // Reconstruct only after completed, and still reject any late failure above.
  const output=new Map((completed.output || []).map((item,index)=>[index,item]));
  for(const [index,item] of items) if(!output.has(index) || !output.get(index).content?.length && item.type==='message') output.set(index,item);
  for(const part of parts.values()) {
    const item=output.get(part.index);
    if(item && item.type!=='message') continue;
    const message=item || {type:'message',role:'assistant',content:[]};
    if(!message.content?.[part.contentIndex]) {
      message.content ||= [];
      message.content[part.contentIndex]=part.type==='refusal'?{type:'refusal',refusal:part.text}:{type:'output_text',text:part.text};
    }
    output.set(part.index,message);
  }
  completed.output=[...output.entries()].sort((a,b)=>a[0]-b[0]).map(([,item])=>item);
  return completed;
}
export async function chatGptComplete(cfg, messages, opts = {}) {
  const rows = await listChatGptModels(cfg.id, { signal: opts.signal, force: false });
  if (!rows.some(r => r.id === cfg.model)) throw new Error('This model is unavailable for your ChatGPT connection. Load models in Settings.');
  let response;
  try { response = parseResponsesStream(await request(cfg.id, JSON.stringify(responsesBody(cfg.model, messages, { ...opts, reasoning: reasoningOptions(cfg, rows.find(r => r.id === cfg.model)) })), opts.signal)); observeChatGptUsage(cfg.id); }
  catch (error) { if (error.name !== 'AbortError') observeChatGptUsage(cfg.id, error); throw error; }
  const output = response.output || [];
  const content = output.filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text' || c.type === 'refusal').map(c => c.text || c.refusal || '').join('\n');
  const calls = output.filter(o => o.type === 'function_call');
  if (calls.some(c => c.namespace && c.namespace !== 'lykos')) throw new Error('ChatGPT requested an unknown tool namespace');
  const u = response.usage || {};
  return { response, message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.call_id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}), _responseItems: output },
    finish: calls.length ? 'tool_calls' : 'stop', usage: { prompt: u.input_tokens ?? null, completion: u.output_tokens ?? null, cached: u.input_tokens_details?.cached_tokens ?? null, cacheWrite: null, cost: null } };
}

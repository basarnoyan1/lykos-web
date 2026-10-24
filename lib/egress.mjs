// What may leave this machine for a model, and the record of what did (plan §3.2 and §3.3). Loaded when the first request is checked, not with the
// shell (lib/ai.mjs guardSend): the check sits in the one place beside assertRoute, so no provider path can skip it.
//
// A connection receives only the data classes it is allowed. A cloud connection starts with none; a connection on this machine starts with all but patient rows (`rows`), which stay off until allowed per connection. The
// allowed classes are stored on the connection's profile (the app-wide settings file on this Mac, with the key, never in a project) together with the
// host they were allowed for, so a connection moved to another host starts again from its default. "Local models only" still wins over any scope.
import { routeOf, PROVIDERS, declared } from './ai.mjs';
import { CLASSES, promptSends, toolSends, contextSends } from './egress-declared.mjs';
import { buildEntry, addSent } from './sent-log.mjs';
export { CLASSES };

/** The classes as a person reads them: a short name for a list and what it covers. */
export const LABELS = Object.freeze({ metadata: 'Records and brief', fulltext: 'Full text and files', values: 'Values and answers', rows: 'Patient rows and datasets', drafts: 'Manuscript and notes' });
export const DETAILS = Object.freeze({
  metadata: 'Titles, abstracts, identifiers, criteria and the project brief',
  fulltext: 'Text and images read from your PDFs and files',
  values: 'Extraction values, appraisal answers and analysis results',
  rows: 'Patient rows and your datasets',
  drafts: 'Manuscript and note text',
});
const PHRASES = Object.freeze({ metadata: 'records and the project brief', fulltext: 'text from your files', values: 'extraction values and answers', rows: 'patient rows and datasets', drafts: 'manuscript and note text' });
const SHORT = Object.freeze({ metadata: 'records', fulltext: 'file text', values: 'values', rows: 'patient rows', drafts: 'manuscript text' });
// A list in words; where a name holds an "and" of its own, the last item gets a comma too, so the list reads one way.
export const classPhrase = classes => { const w = classes.map(c => PHRASES[c] || c); return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')}${w.some(x => x.includes(' and ')) ? ', and ' : ' and '}${w[w.length - 1]}`; };

// ---- the scope of a connection --------------------------------------------------------------------------------------------------------------
/** The host a connection sends to (the account's connection always goes to its own, whatever address the profile holds). */
export function hostOfCfg(cfg) {
  const p = PROVIDERS[cfg?.provider];
  try { return new URL((p?.oauth ? p.base : cfg?.base) || p?.base || '').hostname; } catch { return ''; }
}
/** What a connection may receive until the person chooses: nothing in the cloud; on this machine everything but patient rows (plan §3.2, Q2). */
export const defaultSends = cfg => (routeOf(cfg) === 'local' ? CLASSES.filter(c => c !== 'rows') : []);
/** The classes a connection may receive: those allowed for the host it uses now, else the default for where it runs. */
export function sendsOf(cfg) {
  const s = cfg?.sends;
  return s && Array.isArray(s.classes) && s.host === hostOfCfg(cfg) ? CLASSES.filter(c => s.classes.includes(c)) : defaultSends(cfg);
}
/** The classes of a request that this connection may not receive. */
export const missingFor = (cfg, classes) => { const ok = sendsOf(cfg); return classes.filter(c => !ok.includes(c)); };

// ---- what a request carries -------------------------------------------------------------------------------------------------------------------
const textOf = m => (Array.isArray(m?.content) ? m.content.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('\n') : String(m?.content ?? ''));
const hasImage = m => Array.isArray(m?.content) && m.content.some(p => p?.type === 'image_url' || p?.type === 'image');
const escaped = key => JSON.stringify(key).slice(1, -1);

function scan(messages, out, depth = 0) {
  const calls = new Map();
  for (const m of messages) for (const c of m?.tool_calls || []) if (c?.id) calls.set(c.id, c.function || {});
  for (const m of messages) {
    if (!m) continue;
    const text = textOf(m);
    if (hasImage(m)) out.add('fulltext');
    for (const c of m.sends || []) out.add(c);
    for (const [key, classes] of declared()) if (text.includes(key) || text.includes(escaped(key))) for (const c of classes) out.add(c);
    if (m.role === 'tool') for (const c of calls.has(m.tool_call_id) ? toolSends(calls.get(m.tool_call_id).name, calls.get(m.tool_call_id).arguments) : CLASSES) out.add(c);
    for (const c of contextSends(text)) out.add(c);
    // The compaction of a long run folds its earlier messages into one: what they held travels with it.
    const at = text.indexOf('<data kind="transcript"');
    if (at >= 0) {
      let folded = null;
      if (depth < 2) { try { folded = JSON.parse(text.slice(text.indexOf('\n', at) + 1, text.lastIndexOf('\n</data>'))); } catch { /* cut short or not JSON */ } }
      if (Array.isArray(folded)) scan(folded, out, depth + 1); else for (const c of CLASSES) out.add(c);
    }
  }
}
/**
 * The data classes a request carries, in the order of CLASSES: what its caller declared (`meta.sends`) or, failing that, what its prompt carries
 * (lib/egress-declared.mjs; an unknown prompt carries every class), plus the parts that declared themselves (lib/ai.mjs declare), the results of
 * tools and the chat's context blocks, and any image.
 */
export function classesOf(messages, meta = {}) {
  const prompt = meta.prompt && typeof meta.prompt === 'object' ? meta.prompt : null;
  const out = new Set(Array.isArray(meta.sends) ? meta.sends : meta.prompt ? promptSends(meta.prompt) : CLASSES);
  if (!Array.isArray(meta.sends) && prompt?.brief && prompt.brief !== 'none') out.add('metadata');
  scan(messages || [], out);
  return CLASSES.filter(c => out.has(c));
}

// ---- the check and the record --------------------------------------------------------------------------------------------------------------------
/**
 * The refusal for classes a connection may not receive, in plain words, naming the classes and the setting that allows them. The chat shows the first 200
 * characters of an error, so the setting comes before anything that can be dropped: the host goes first when the message would be longer.
 */
export function refusal(cfg, missing) {
  const name = String(cfg?.label || cfg?.model || PROVIDERS[cfg?.provider]?.label || 'this connection'), who = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  const host = hostOfCfg(cfg), it = missing.length === 1 ? 'it' : 'them';
  const what = missing.length === CLASSES.length ? 'project data of any kind' : missing.length > 2 ? classPhrase(missing.map(c => SHORT[c])) : classPhrase(missing);
  const head = `Not sent: ${what} may not go to ${who}`, tail = ` Allow ${it} in Settings > Models, under Data this connection may receive.`;
  const full = `${head}${host ? ` (${host})` : ''}.${tail}`;
  return Object.assign(new Error(full.length <= 195 ? full : `${head}.${tail}`), { kind: 'egress-scope', classes: missing });
}
// SHA-256 of a string, first 8 bytes as 16 hex digits (the request's hash in the Sent log and on its call record). Synchronous, so a send is not delayed.
const K = Uint32Array.from({ length: 64 }, (_, i) => { let n = 2, c = 0; for (let m = 0; m <= i; n++) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { c = n; m++; } } return Math.floor((c ** (1 / 3) % 1) * 2 ** 32); });
export function sha256Hex(text) {
  const data = new TextEncoder().encode(text), len = data.length, size = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(size);
  buf.set(data); buf[len] = 0x80;
  new DataView(buf.buffer).setUint32(size - 4, (len * 8) >>> 0); new DataView(buf.buffer).setUint32(size - 8, Math.floor(len / 0x20000000));
  const w = new Uint32Array(64), H = Uint32Array.from([2, 3, 5, 7, 11, 13, 17, 19], p => Math.floor(Math.sqrt(p) % 1 * 2 ** 32)), rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < size; o += 64) {
    const dv = new DataView(buf.buffer, o, 64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0, t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return Array.from(H.slice(0, 2), v => v.toString(16).padStart(8, '0')).join('');
}
const hashOf = (cfg, messages) => sha256Hex(JSON.stringify({ model: cfg.model || '', messages: (messages || []).map(({ cache, _responseItems, sends, ...m }) => m) }));
const kindOf = meta => meta.task || (meta.prompt && (typeof meta.prompt === 'string' ? meta.prompt.split('@')[0] : meta.prompt.id)) || (Array.isArray(meta.sends) && !meta.sends.length ? 'connection test' : 'request');
/**
 * Checks one request against the connection's scope and records it in the Sent log. Throws the refusal (kind 'egress-scope') before anything is sent;
 * otherwise resolves to the request's hash, which the call record keeps. Called by lib/ai.mjs guardSend after assertRoute, for every provider path.
 */
export function screen(cfg, messages, meta = {}) {
  const classes = classesOf(messages, meta), missing = missingFor(cfg, classes);
  if (missing.length) throw refusal(cfg, missing);
  const hash = hashOf(cfg, messages);
  addSent(buildEntry({ cfg, host: hostOfCfg(cfg), route: routeOf(cfg), model: cfg.model || PROVIDERS[cfg.provider]?.defaultModel || cfg.provider, kind: kindOf(meta), classes, messages, hash }));
  return hash;
}

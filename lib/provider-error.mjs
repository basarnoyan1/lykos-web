// A provider's refusal, or a connection that never got an answer, in plain words. Every failure is a `kind`, one cause sentence and one
// step to take; the message of the Error is "cause next", so the sentence is never cut mid-word. What the provider actually said stays
// on `detail` (full, for a tooltip or a disclosure). The request is never part of the text, so no key is either: `redact` removes key
// shapes, and `scrub` removes the exact secrets a caller holds.
const redact = s => String(s || '').replace(/\s+/g, ' ').replace(/\b(?:sk|key|pk)-[\w-]{8,}/gi, '…').trim();
/** `text` with each of the given secrets (a key the person pasted) replaced; short values are left alone so a word is never mangled. */
export const scrub = (text, secrets = []) => secrets.filter(x => typeof x === 'string' && x.length >= 6)
  .reduce((out, secret) => out.split(secret).join('…'), String(text ?? ''));

/** The message inside a provider's JSON error body (OpenAI, OpenRouter, Anthropic shapes), or the plain text. */
export function providerDetail(body) {
  let data = body;
  if (typeof body === 'string') { try { data = JSON.parse(body); } catch { data = null; } }
  const raw = data?.error?.message ?? (typeof data?.error === 'string' ? data.error : null) ?? data?.message ?? (data == null && typeof body === 'string' ? body : '');
  return redact(typeof raw === 'string' ? raw : '');
}

// ---- what each failure says ---------------------------------------------------------------------------------------------------------------
// `x` = { who, host, model, ollama }. A sentence names its subject and ends in the step, so it reads whole in a row, a note or a dialog.
const FAILURES = {
  'no-provider': () => ['No provider is chosen.', 'Choose one in Settings, Models.'],
  'no-key': x => [`No API key is set for ${x.who}.`, 'Paste the key in the API key field.'],
  'no-endpoint': () => ['No endpoint address is set.', 'Enter the address the provider gives you; it usually ends in /v1.'],
  'bad-address': () => ['The endpoint is not a usable address.', 'Start it with https://, or http://localhost for a server on this Mac.'],
  'no-model': () => ['No model is chosen.', 'Choose one, or load the list of models.'],
  'no-models': x => [`${x.who} listed no models.`, 'Check the endpoint address, or type a model name by hand.'],
  'no-account': () => ['ChatGPT is not signed in.', 'Choose Continue with ChatGPT.'],
  'desktop-only': () => ['This sign-in needs the desktop app.', 'Open Lykos as an app, or use an API key instead.'],
  'bad-key': x => [`${x.who} did not accept the API key.`, 'Check the key in Settings, Models.'],
  'forbidden': x => [`${x.who} refused this key.`, 'Check what the key may use in the provider’s console.'],
  'not-found': x => [`${x.who} has nothing at this address.`, 'Check the endpoint and model in Settings, Models.'],
  'rate-limit': x => [`${x.who} is rate limiting this key.`, 'Wait a minute, then try again.'],
  'quota': x => [`${x.who} says the quota or credit on this account is used up.`, 'Add credit or raise the limit in the provider’s billing settings.'],
  'server': x => [`${x.who} had a server error.`, 'Try again shortly.'],
  'proxy': () => ['A proxy on the network asked for a sign-in.', 'Sign in to the network or check the proxy settings, then try again.'],
  'model-missing': x => [`${x.who} has no model called “${x.model || 'this one'}”.`,
    x.ollama ? `Pull it with “ollama pull ${x.model || 'name'}”, or choose an installed model.` : 'Choose another model in Settings, Models.'],
  'not-api': x => [`${x.host || x.who} answered with something that is not a model list.`, 'Check the endpoint address; it usually ends in /v1.'],
  'local-down': x => [`Nothing answered at ${x.host || 'the local address'}.`, x.ollama ? 'Start Ollama (open the app, or run “ollama serve”), then test again.' : 'Start the local model server, then test again.'],
  'cors-or-down': x => [`The browser could not reach ${x.host || 'the local server'}: it may not be running, or it may refuse requests from this web page (CORS).`,
    'Start it and allow this page in its CORS settings; the desktop app is not limited this way.'],
  'blocked-or-down': x => [`The browser could not reach ${x.host || 'the server'}.`,
    'Check the address and the connection; if both are right, the provider may refuse web pages (CORS). The desktop app is not limited this way.'],
  'unreachable': x => [`Could not reach ${x.host || 'the server'}.`, 'Check the internet connection, the address, and any VPN or proxy.'],
  'dns': x => [`The address ${x.host || ''} was not found.`.replace('  ', ' '), 'Check the spelling of the endpoint, then try again.'],
  'tls': x => [`A secure connection to ${x.host || 'the server'} could not be made.`, 'Check the computer’s date and time, and any proxy, VPN or security software that inspects traffic.'],
  'timeout': x => [`${x.who} did not answer in time.`, 'Try again; if it keeps happening, check the connection and the endpoint.'],
  'workspace': () => ['This API key is not scoped to a workspace.', 'Enter the Workspace ID in Settings, Models.'],
};
/** The kinds a person can hit, in the order of the checks: the step of a test that each one stops. */
export const FAILURE_STEP = Object.freeze({ setup: ['no-provider', 'no-key', 'no-endpoint', 'bad-address', 'no-account', 'desktop-only', 'local-only'],
  host: ['not-found', 'not-api', 'local-down', 'cors-or-down', 'blocked-or-down', 'unreachable', 'dns', 'tls', 'timeout', 'proxy', 'no-models'],
  key: ['bad-key', 'forbidden', 'workspace', 'quota', 'rate-limit'], model: ['no-model', 'model-missing', 'server', 'odd-reply'] });
export const stepOf = kind => Object.keys(FAILURE_STEP).find(step => FAILURE_STEP[step].includes(kind)) || 'model';

/** A failure as an Error: `kind`, `cause`, `next`, `status`, `detail` (what the provider said, whole) and the sentence as its message. */
export function failure(kind, x = {}, extra = {}) {
  const [cause, next] = (FAILURES[kind] || (() => [extra.cause || 'The request failed.', '']))(x);
  const err = new Error(next ? `${cause} ${next}` : cause);
  return Object.assign(err, { kind, cause, next, status: null, detail: '' }, extra);
}

const QUOTA = /insufficient[_ ]quota|exceeded your (?:current )?quota|quota (?:exceeded|has been)|credit balance|insufficient (?:credit|funds)|out of credit|billing (?:hard )?limit|payment required|(?:buy|add)\s(?:credit|a payment)/i;
const MODEL_GONE = /model[^.]{0,80}(?:not found|does not exist|not a valid|is not supported|not available|no longer)|(?:unknown|invalid|unsupported|no such) model|model_not_found|try pulling it first|no endpoints found/i;

/** `who`: "DeepSeek", "The endpoint". `x`: { model, ollama } for the sentence. Returns an Error with `kind`, `status` and the provider’s own words as `detail`. */
export function providerError(status, body, who = 'The provider', x = {}) {
  const detail = providerDetail(body);
  const kind = status === 401 ? 'bad-key' : status === 407 ? 'proxy'
    : status === 402 || ((status === 403 || status === 429) && QUOTA.test(detail)) ? 'quota'
    : status === 403 ? 'forbidden'
    : (status === 404 || status === 400) && MODEL_GONE.test(detail) ? 'model-missing'
    : status === 404 ? 'not-found' : status === 429 ? 'rate-limit' : status >= 500 ? 'server' : '';
  if (kind) return failure(kind, { who, ...x }, { status, detail });
  const err = new Error(`${who} could not accept the request${detail ? `: ${detail}` : ` (HTTP ${status})`}`);
  return Object.assign(err, { kind: 'rejected', status: status || null, detail, cause: err.message, next: '' });
}

/** The host a sentence names: address and port, never a path, a query or credentials (a key may sit in any of them). */
export function hostLabel(url) {
  try { const u = new URL(url); return u.host; } catch { return ''; }
}
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|[^/]*\.localhost)$/i;
export const isLoopback = url => { try { return LOCAL_HOST.test(new URL(url).hostname); } catch { return false; } };

/**
 * A request that got no answer: what the runtime threw (a Node or browser fetch error, or the desktop shell's text) and the url it was
 * for, as a failure. The browser says only "Failed to fetch" whether the host is down, the name is wrong, a certificate failed or the
 * server refuses web pages, so for a page it names those possibilities; the desktop shell and Node report a cause code where there is one.
 */
export function networkFailure(error, url, { who = 'The server', ollama = false } = {}) {
  const host = hostLabel(url), local = isLoopback(url);
  const text = [error?.message, error?.cause?.message, typeof error === 'string' ? error : '', error?.cause?.code, error?.code].filter(Boolean).join(' ');
  const code = String(error?.cause?.code || error?.code || '');
  const x = { who, host, ollama: ollama || /:11434$/.test(host) };
  const detail = redact(text).replace(/\(?https?:\/\/\S+/gi, '').trim();
  const kind = /cert|ssl|tls|self.signed|unable_to_verify|handshake/i.test(`${code} ${text}`) ? 'tls'
    : /ENOTFOUND|EAI_AGAIN|dns error|failed to lookup|name resolution|nodename nor servname|not known/i.test(`${code} ${text}`) ? 'dns'
    : /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed out|timeout/i.test(`${code} ${text}`) ? 'timeout'
    : /^(Failed to fetch|Load failed|NetworkError)/i.test(String(error?.message || error)) && !code ? (local ? 'cors-or-down' : 'blocked-or-down')
    : /not allowed|must be https|scheme/i.test(text) ? 'bad-address'
    : local ? 'local-down' : 'unreachable';
  return failure(kind, x, { detail });
}

/** A reply that is not a model API at all: a web page, an empty body, JSON of another shape. */
export const notApi = (url, who) => failure('not-api', { who, host: hostLabel(url) });

/** The provider's name for a sentence: "DeepSeek", "OpenRouter"; a custom endpoint is "The endpoint". */
export const providerWho = (cfg, providers) => cfg?.provider === 'openaiCompatible' ? 'The endpoint' : String(providers?.[cfg?.provider]?.label || 'The provider').replace(/\s*\(.*\)\s*$/, '');

/**
 * What a row shows for a failed request: `text` is whole and short (the first sentence, or the message cut at a word with an
 * ellipsis when one sentence is still long); `full` is everything the provider said, for the tooltip, or '' when text is all of it.
 */
export function problemOf(err, { max = 140, secrets = [] } = {}) {
  const clean = s => scrub(redact(s), secrets);
  const message = clean(String(err?.message ?? err ?? '')).replace(/^models:\s*/i, '') || 'The request failed.';
  const full = clean([message, err?.detail && !message.includes(err.detail) ? err.detail : ''].filter(Boolean).join(' '));
  if (message.length <= max) return { text: message, full: full === message ? '' : full };
  const first = message.match(/^.*?[.!?](?=\s|$)/)?.[0] || '';
  if (first && first.length <= max) return { text: first, full };
  const cut = message.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '');
  return { text: `${cut}…`, full };
}

/**
 * A failure for display: `kind`, `cause`, `next` (each whole, scrubbed of the given secrets), `text` (cause and step as one sentence run,
 * never cut) and `full` (everything the provider said, '' when `text` is all of it). An Error from elsewhere is its message, kind 'other'.
 */
export function diagnose(err, { secrets = [] } = {}) {
  const clean = s => scrub(redact(s), secrets);
  const known = typeof err?.kind === 'string';
  const cause = clean(typeof err?.cause === 'string' ? err.cause : err?.message ?? err).replace(/^models:\s*/i, '') || 'The request failed.';
  const parts = [cause, known && typeof err.next === 'string' ? clean(err.next) : ''];
  const text = parts.filter(Boolean).join(' ');
  const detail = clean(err?.detail || '');
  return { kind: known ? err.kind : 'other', cause: parts[0], next: parts[1], text, full: detail && !text.includes(detail) ? `${text} ${detail}` : '' };
}

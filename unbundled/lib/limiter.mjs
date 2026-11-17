// Registry requests, paced and retried.
//
// Each registry publishes a rate: NCBI E-utilities 3 requests/s (10 with an
// API key), Crossref and OpenAlex ask for a polite pace with a mailto, Europe
// PMC tolerates a few per second. A burst past those limits answers 429 and
// then everything fails at once — identification of a folder of PDFs, a
// scheduled search, an abstract fetch. So every registry call goes through one
// queue per host: a token bucket paces it, a 429 or 5xx is retried with
// backoff (honouring Retry-After), and the interface can show that it is
// waiting rather than broken.
import { clock as clockOf } from './dates.mjs';

const HOSTS = [
  { match: /eutils\.ncbi\.nlm\.nih\.gov|\/proxy\/eutils/, name: 'PubMed',     perSec: 2 },
  { match: /api\.crossref\.org/,                           name: 'Crossref',   perSec: 5 },
  { match: /api\.openalex\.org/,                           name: 'OpenAlex',   perSec: 8 },
  { match: /ebi\.ac\.uk|\/proxy\/epmc/,                    name: 'Europe PMC', perSec: 5 },
  { match: /clinicaltrials\.gov/,                          name: 'ClinicalTrials.gov', perSec: 3 },
  { match: /api\.unpaywall\.org/,                          name: 'Unpaywall',  perSec: 5 },
  // Model calls: no pacing to speak of, but a 429 or 529 is retried here and shown as waiting.
  { match: /^https:\/\/api\.anthropic\.com\//,             name: 'Claude',     perSec: 8 },
];
const buckets = new Map();   // name -> { tokens, last, perSec, queue }
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = (name, msg) => { for (const l of listeners) l(name, msg); };

/** A key raises NCBI's allowance; the caller says so once it knows. */
export function setRate(name, perSec) { const b = bucket(name); if (b) b.perSec = perSec; }

function hostOf(url) { return HOSTS.find(h => h.match.test(url)) || null; }
function bucket(name) {
  const h = HOSTS.find(x => x.name === name); if (!h) return null;
  // starts with one token, not a full bucket: a burst is what gets refused
  if (!buckets.has(name)) buckets.set(name, { tokens: 1, last: performance.now(), perSec: h.perSec, chain: Promise.resolve() });
  return buckets.get(name);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Waits for a token: at most perSec calls start in any one second. */
async function pace(b) {
  const run = async () => {
    const now = performance.now();
    // never more than one token: an idle bucket must not buy a burst later
    b.tokens = Math.min(1, b.tokens + ((now - b.last) / 1000) * b.perSec);
    b.last = now;
    if (b.tokens < 1) { await sleep(((1 - b.tokens) / b.perSec) * 1000); b.tokens = 0; b.last = performance.now(); }
    else b.tokens -= 1;
  };
  // serialised per host so bursts queue instead of racing the bucket
  const p = b.chain.then(run, run); b.chain = p; return p;
}

/**
 * fetch with pacing and retries. `doFetch` is the raw call (fetch, or the
 * shell's request in the desktop app) returning { ok, status, headers?, text() }.
 */
// A Retry-After longer than this is a closed quota (OpenAlex answers a spent
// daily allowance with five hours), not congestion. Sleeping through it held
// the whole identification queue; instead the host is marked unavailable until
// then, and every call to it answers at once with the same refusal.
const LONGEST_WAIT = 60e3;
const closedUntil = new Map();   // host name -> epoch ms
const refused = () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => '', json: async () => ({}) });
const clock = t => clockOf(t);

// A daily allowance, where the host reports one (OpenAlex sends x-ratelimit-limit,
// -remaining and -reset, in credits and seconds until midnight UTC, on every
// answer, and exposes them to a browser). The last figures seen are kept so the
// interface can say what is left without spending a request to ask.
const budgets = new Map();   // host name -> { limit, remaining, resetAt, at }
const budgetListeners = new Set();
export const onBudget = fn => { budgetListeners.add(fn); return () => budgetListeners.delete(fn); };
export const budgetOf = name => budgets.get(name) || null;
const num = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
function readBudget(name, res) {
  const head = k => res.headers?.get?.(k);
  const limit = num(head('x-ratelimit-limit')), remaining = num(head('x-ratelimit-remaining')), reset = num(head('x-ratelimit-reset'));
  if (limit == null && remaining == null) return null;
  const b = { limit, remaining, resetAt: reset != null ? Date.now() + reset * 1000 : null, at: Date.now() };
  budgets.set(name, b);
  for (const l of [...budgetListeners]) l(name, b);
  return b;
}
/** When a host that refused for the day accepts requests again (epoch ms), or 0 while it is open. */
export const closedUntilOf = name => { const t = closedUntil.get(name) || 0; return t > Date.now() ? t : 0; };
/** Forget a closed day: a key was added, which raises the allowance. */
export function reopen(name) { closedUntil.delete(name); const b = budgets.get(name); if (b) budgets.set(name, { ...b, remaining: null }); }
/** The next midnight UTC, when OpenAlex renews its allowance. */
export const nextMidnightUtc = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
/** A day's allowance is spent: the host answers 429 and says nothing of a short wait. */
export class AllowanceError extends Error {
  constructor(source, resumeAt, keyed = false) {
    super(`${source}: today's allowance is used up. ${keyed ? 'Wait' : 'Add a free API key in Settings, Sources, or wait'} until ${clock(resumeAt)}`);
    this.name = 'AllowanceError'; this.source = source; this.resumeAt = resumeAt; this.keyed = keyed;
  }
}

export async function limited(url, doFetch, { retries = 3, signal } = {}) {
  const h = hostOf(url);
  const b = h ? bucket(h.name) : null;
  if (h && (closedUntil.get(h.name) || 0) > Date.now()) return refused();
  let attempt = 0;
  for (;;) {
    if (b) await pace(b);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    let res;
    try { res = await doFetch(url); }
    catch (err) {
      // The last "retrying in" line would otherwise stay in the status bar after the call gave up.
      if (signal?.aborted || globalThis.navigator?.onLine === false || attempt >= retries) { if (attempt) tell(h?.name || 'network', ''); throw err; }
      const wait = 800 * 2 ** attempt; attempt++;
      tell(h?.name || 'network', `${h?.name || 'Network'}: retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait); continue;
    }
    const seen = h ? readBudget(h.name, res) : null;
    // A host not in the list (a custom endpoint) gets its answer as it is: the waits below are kept per named host.
    if (!h || res.ok || (res.status < 500 && res.status !== 429) || attempt >= retries) { if (b) tell(h.name, ''); return res; }
    const after = Number(res.headers?.get?.('retry-after')) || 0;
    // A refusal with nothing left of the day's allowance will not clear by waiting a few seconds.
    const spent = res.status === 429 && seen && seen.remaining != null && seen.remaining <= 0;
    const wait = after ? after * 1000 : spent ? Math.max(LONGEST_WAIT + 1, seen.resetAt ? seen.resetAt - Date.now() : nextMidnightUtc() - Date.now())
      : Math.min(8000, 800 * 2 ** attempt);
    if (wait > LONGEST_WAIT) {
      const until = Date.now() + wait;
      closedUntil.set(h.name, until);
      tell(h.name, `${h.name}: unavailable until ${clock(until)}`);
      return res;
    }
    attempt++;
    tell(h.name, `${h.name}: ${res.status === 429 ? 'rate limited' : `HTTP ${res.status}`}, retrying in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
}

/** Test seam: forget every bucket, budget and closed day. */
export function resetLimiter() { buckets.clear(); closedUntil.clear(); budgets.clear(); }

/** NCBI's allowance is 3 requests/s, 10 with an API key; the pace follows the settings. */
export function applyRates(settings) { setRate('PubMed', settings?.ncbiKey ? 8 : 2); }

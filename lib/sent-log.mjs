// The Sent log (plan §3.3): what actually left this machine for a model, one entry per request, recorded at the single check beside assertRoute
// (lib/ai.mjs guardSend, lib/egress.mjs screen). An entry holds the time, the connection (its label and host, never its key), the model, the kind
// of request, the data classes it carried, its size, the first 200 characters of its last message and a hash of the whole request, which is also
// kept on the call record (`sent`) so the two can be matched. It keeps an excerpt, not the request, because a full copy would put patient data in
// a second place. The log is kept app-wide on this Mac, beside the connections (lib/app-settings.mjs), and never in a project file, backup, export or recovery copy
// (excerpts may quote patient data). It is bounded, and can be cleared and exported.
import { appSent, setSent } from './app-settings.mjs';

export const EXCERPT = 200;
/** How much is kept: the newest entries, none older than the age. */
export const RETENTION = Object.freeze({ entries: 1000, days: 90 });
const DAY = 86400e3;

// A pasted key is not logged: key shapes and the connection's own key are removed from the excerpt.
const KEY_SHAPE = /\b(?:sk|key|pk)-[\w-]{8,}|\bBearer\s+[\w.~+/=-]{12,}/gi;
const scrub = (text, key) => {
  let t = String(text ?? '');
  if (key && String(key).length >= 8) t = t.split(String(key)).join('…');
  return t.replace(KEY_SHAPE, '…');
};
const textOf = m => (Array.isArray(m?.content) ? m.content.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join(' ') : String(m?.content ?? ''));

/** The excerpt of a request: the first 200 characters of its last user message (else its last message), on one line. */
export function excerptOf(messages, key = '') {
  const list = (messages || []).filter(m => m && m.role !== 'tool' || m?.content), mine = list.filter(m => m.role === 'user');
  const last = mine.length ? mine[mine.length - 1] : list[list.length - 1];
  const one = scrub(textOf(last), key).replace(/\s+/g, ' ').trim();
  return one.length > EXCERPT ? `${one.slice(0, EXCERPT - 1)}…` : one;
}
/** The size of a request in characters (the text of every message; an image counts as its reference). */
export const charsOf = messages => (messages || []).reduce((n, m) => n + textOf(m).length, 0);

/**
 * One entry, from what the check knows. `route` is 'local' or 'cloud'; `classes` the data classes the request carried; `hash` the request's hash.
 * Nothing about the key but its absence from the excerpt: the connection is named by label and host.
 */
export function buildEntry({ cfg, host, route, model, kind, classes, messages, hash, at = new Date().toISOString() }) {
  return { id: `s${Date.parse(at).toString(36)}${hash.slice(0, 6)}`, at, profileId: cfg?.id || null, connection: String(cfg?.label || cfg?.model || cfg?.provider || '').slice(0, 80),
    provider: cfg?.provider || '', host, route, model: String(model || '').slice(0, 120), kind, classes: [...classes], chars: charsOf(messages), parts: (messages || []).length,
    excerpt: excerptOf(messages, cfg?.key), hash };
}

/** The entries to keep: newest first, the newest `entries`, none older than `days`. */
export function retain(list, now = Date.now()) {
  return (list || []).filter(e => e && Date.parse(e.at) >= now - RETENTION.days * DAY).slice(0, RETENTION.entries);
}
export const sentEntries = () => appSent();
export const addSent = entry => setSent(retain([entry, ...appSent()]));
export const clearSent = () => setSent([]);

export const CSV_HEADER = Object.freeze(['Time', 'Connection', 'Host', 'Route', 'Model', 'Kind', 'Data classes', 'Characters', 'Messages', 'Hash', 'Excerpt']);
// A cell that a spreadsheet would read as a formula is written as text.
const cell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
/** The log as CSV (one header row, one row per entry, newest first), for the owner to keep or audit. */
export function sentCsv(entries) {
  const rows = (entries || []).map(e => [e.at, e.connection, e.host, e.route, e.model, e.kind, (e.classes || []).join(' '), e.chars, e.parts, e.hash, e.excerpt]);
  return `${[CSV_HEADER, ...rows].map(r => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

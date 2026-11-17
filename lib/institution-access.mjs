// Institutional access (Settings › Literature access). OpenAthens is a redirector, not a proxy: the person signs in on their
// institution's page and each publisher keeps its own session in the Lykos browser (src-tauri/src/browser.rs), so nothing is
// copied here. A record opened that way waits for the PDF the person then saves there; the PDF is attached to it only when its
// title or DOI matches the record (lib/pdf-identity.mjs). EZproxy is used by the shell's retrieval itself (paperbot.py).
import { lib_native$openLink as openLink } from "../boot.mjs";
import { browserTakePdfNative, onBrowserPdf } from './native-extra.mjs';

/** A domain as OpenAthens names an organisation ("myuni.edu"), from the domain or a pasted redirector link; '' when it is neither. */
export function openAthensDomain(raw) {
  let v = String(raw || '').trim();
  const link = /go\.openathens\.net\/redirector\/([^/?#\s]+)/i.exec(v);
  if (link) v = link[1];
  v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v) ? v : '';
}

/**
 * The OpenAthens redirector link for a page (`https://…`) or a DOI ("10.1016/…", which becomes its doi.org address). `domain` may be a
 * domain or a pasted redirector link; '' when it is neither, or when the target is not a web address. A redirector link is not wrapped again.
 * The Lykos browser's "Open through institution" builds its twin in Rust (src-tauri/src/browser.rs, institution_link; form-encoded there, same decoded value).
 */
export function openAthensLink(domain, target) {
  const d = openAthensDomain(domain), t = String(target || '').trim();
  if (!d || !t) return '';
  let url;
  if (/^https?:\/\//i.test(t)) {
    try { url = new URL(t); } catch { return ''; }
    if (url.username || url.password) return '';
    if (url.hostname === REDIRECTOR_HOST) return url.href;
    url.hash = '';   // a fragment never leaves a browser otherwise, and the redirector does not need it
  } else if (/^(?:doi:\s*)?10\.\d{4,9}\/\S+$/i.test(t)) url = new URL(`https://doi.org/${t.replace(/^doi:\s*/i, '')}`);
  else return '';
  return `https://${REDIRECTOR_HOST}/redirector/${d}?url=${encodeURIComponent(url.href)}`;
}
const REDIRECTOR_HOST = 'go.openathens.net';

/**
 * Institutions whose access is known: the one place an institution is named in code. Any other is the two fields typed in. `verified` is false
 * until a real sign-in has gone through the domain; `note` is shown once beside the choice. `vpnApp` names the VPN client (in /Applications);
 * Settings shows the VPN row only once `vpnChecked` is true: its status was seen right with the client connected and disconnected.
 */
export const INSTITUTION_PRESETS = Object.freeze([
  Object.freeze({ id: 'koc', name: 'Koç University', openAthensDomain: 'ku.edu.tr', verified: false, ezproxyPrefix: '', vpnApp: 'Ivanti Secure Access',
    vpnChecked: false, note: 'Active KU account; alumni have no access' }),
]);

/** The VPN row's status line for `vpn_state`'s answer (src-tauri/src/vpn.rs): a tunnel with an address, none, or no way to tell. */
export const vpnText = state => ({ on: 'Connected', off: 'Not connected' })[state?.state] || 'Not detected';

/** The preset the stored fields match (domain and EZproxy address both as the preset has them), or null. */
export function presetFor(values = {}) {
  const d = openAthensDomain(values.openathensDomain), e = ezproxyPrefix(values.ezproxyUrl);
  return INSTITUTION_PRESETS.find(p => p.openAthensDomain === d && (p.ezproxyPrefix || '') === e) || null;
}

/** A fixed DOI the "Test sign-in" opens through the redirector: the person sees their institution's sign-in, or OpenAthens's error for a wrong domain. */
export const TEST_SIGN_IN_DOI = '10.1016/S0140-6736(20)30183-5';

/** An EZproxy login prefix ("https://login.ezproxy.myuni.edu/login?url="), or '' when the address is not https. */
export function ezproxyPrefix(raw) {
  const v = String(raw || '').trim();
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? v : ''; } catch { return ''; }
}

const WAIT_MS = 30 * 60 * 1000;
let waiting = null, listening = false, queue = null;

/**
 * The records the Library's "Fetch missing through my institution" goes through (31 Oct 2026; as `lykos-papers fetch-institution --missing`):
 * the included ones, their linked reports and the undecided full texts that have a DOI and no PDF, in the project's order.
 */
export function missingForInstitution(state) {
  const ft = state?.fulltext || {}, inc = new Set(Object.entries(ft).filter(([, d]) => d?.decision === 'include').map(([id]) => id));
  return (state?.papers || []).filter(p => String(p.doi || '').trim() && !(p.pdf || p.pdfRel)
    && (inc.has(p.id) || (p.reportOf && inc.has(p.reportOf)) || ft[p.id]?.decision === 'uncertain'));
}

/**
 * The batch in the Lykos browser: each record opened through OpenAthens in turn; when the PDF the person saves there matches, it is attached
 * and the next record opens by itself. Called again while it runs, it skips the record on screen. `say(text)` reports each step;
 * resolves to what it did ('started', 'next', 'done').
 */
export async function openQueueThroughOpenAthens(papers, domain, opts) {
  if (queue && queue.project === opts.project && queue.left.length) return advance('skipped');
  if (queue && queue.project === opts.project && waiting) { queue = null; waiting = null; opts.say('No record left to fetch through the institution'); return 'done'; }
  const list = [...papers];
  if (!list.length) { opts.say('Every included record with a DOI has its PDF'); return 'done'; }
  queue = { project: opts.project, domain, opts, left: list.slice(1), total: list.length, n: 1 };
  opts.say(`1 of ${list.length}: ${list[0].label || 'record'} opened through your institution; save its PDF there`);
  await openThroughOpenAthens(list[0], domain, { ...opts, queued: true });
  return 'started';
}
async function advance(why) {
  const q = queue;
  if (!q || !q.opts.current(q.project)) { queue = null; return 'done'; }
  if (!q.left.length) { queue = null; waiting = null; q.opts.say(`Done: ${q.total} record${q.total === 1 ? '' : 's'} gone through`); return 'done'; }
  const next = q.left.shift(); q.n++;
  q.opts.say(`${why === 'skipped' ? 'Skipped. ' : ''}${q.n} of ${q.total}: ${next.label || 'record'} opened through your institution`);
  await openThroughOpenAthens(next, q.domain, { ...q.opts, queued: true });
  return 'next';
}

/**
 * Opens the record's DOI through OpenAthens in the Lykos browser and waits there for its PDF. `attach(paper, file, hash, origin)` stores a PDF
 * that matches; `origin` is where the browser saved it from, `{ url, page, at }` (the file's address, the page it was on, when; each may be null); `say(text)` reports what happened to it. Resolves to where the link opened.
 */
export async function openThroughOpenAthens(paper, domain, { project, current, attach, say, queued = false }) {
  if (!queued) queue = null;   // one record opened by hand ends a batch
  const link = openAthensLink(domain, paper.doi);
  // a DOI that is not one (no "10.NNNN/" prefix) opens nothing; in a batch the next record opens
  if (!link) { say(`${paper.label || 'This record'} has no usable DOI`); return queued && queue ? advance('skipped') : 'none'; }
  if (!listening) { listening = true; onBrowserPdf(received); }
  waiting = { paper, project, current, attach, say, queued, until: Date.now() + WAIT_MS };
  return openLink(link);
}

async function received({ id, name, url = null, page = null, at = null }) {
  const w = waiting;
  if (!w || Date.now() > w.until || !w.current(w.project)) return;
  let bytes;
  try { bytes = new Uint8Array(await browserTakePdfNative(id)); } catch (error) { w.say(String(error?.message || error)); return; }
  let parsed;
  try {
    // PDF.js loads only when a PDF arrives: Settings imports this module for its two checks
    const [anchor, identity] = await Promise.all([import('./anchor.mjs'), import('./pdf-identity.mjs')]);
    parsed = await anchor.loadPdf(bytes.slice());   // pdf.js may take the buffer it is given
    if (!await identity.matchesRetrievedPdf(parsed.doc, w.paper)) { w.say(`${name} does not match ${w.paper.label || 'this record'}; it stays in Downloads`); return; }
  } catch { w.say(`${name} could not be read as a PDF`); return; }
  finally { await parsed?.doc?.destroy?.(); }
  waiting = null;
  await w.attach(w.paper, new File([bytes], name || 'paper.pdf', { type: 'application/pdf' }), parsed.hash, { url, page, at });
  w.say(`${name} attached to ${w.paper.label || 'the record'}`);
  if (w.queued && queue) await advance('attached');
}

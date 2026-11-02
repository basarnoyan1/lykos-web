// Institutional access (Settings › Literature access). OpenAthens is a redirector, not a proxy: the person signs in on their
// institution's page and each publisher keeps its own session in the Lykos browser (src-tauri/src/browser.rs), so nothing is
// copied here. A record opened that way waits for the PDF the person then saves there; the PDF is attached to it only when its
// title or DOI matches the record (lib/pdf-identity.mjs). EZproxy is used by the shell's retrieval itself (paperbot.py).
import { lib_native$browserTakePdfNative as browserTakePdfNative, lib_native$onBrowserPdf as onBrowserPdf, lib_native$openLink as openLink } from "../boot.mjs";

/** A domain as OpenAthens names an organisation ("myuni.edu"), from the domain or a pasted redirector link; '' when it is neither. */
export function openAthensDomain(raw) {
  let v = String(raw || '').trim();
  const link = /go\.openathens\.net\/redirector\/([^/?#\s]+)/i.exec(v);
  if (link) v = link[1];
  v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v) ? v : '';
}

/** The OpenAthens redirector link for a DOI. */
export const openAthensLink = (domain, doi) => `https://go.openathens.net/redirector/${domain}?url=${encodeURIComponent(`https://doi.org/${String(doi).trim()}`)}`;

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
 * Opens the record's DOI through OpenAthens in the Lykos browser and waits there for its PDF. `attach(paper, file)` stores a PDF
 * that matches; `say(text)` reports what happened to it. Resolves to where the link opened.
 */
export async function openThroughOpenAthens(paper, domain, { project, current, attach, say, queued = false }) {
  if (!listening) { listening = true; onBrowserPdf(received); }
  if (!queued) queue = null;   // one record opened by hand ends a batch
  waiting = { paper, project, current, attach, say, queued, until: Date.now() + WAIT_MS };
  return openLink(openAthensLink(domain, paper.doi));
}

async function received({ id, name }) {
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
  await w.attach(w.paper, new File([bytes], name || 'paper.pdf', { type: 'application/pdf' }), parsed.hash);
  w.say(`${name} attached to ${w.paper.label || 'the record'}`);
  if (w.queued && queue) await advance('attached');
}

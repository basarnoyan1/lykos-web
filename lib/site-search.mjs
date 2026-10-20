// Web of Science and Scopus, searched in the user's own signed-in session
// (plan B1, B6; the window and its isolation are src-tauri/src/site.rs).
//
// A run is a macro of the steps a person would take on the site's advanced
// search page: fill the query, press Search, read the count, and export the
// records through the site's own export dialog in the batch size it allows.
// Each step finds its element by a locator — shipped defaults, or one the user
// taught by clicking it — and waits for it rather than failing on a slow page.
// A sign-in page, a CAPTCHA or a bot check is never answered here: the run
// hands the window to the user and resumes when the page is back.
import { parseRecords } from './bib.mjs';
import { recordKey } from './sources.mjs';
import { addSearchRecords } from './search-library.mjs';

// ---- the two services -------------------------------------------------------
// Steps, in order. `mode` is what the step does; `when` says whether it is
// always needed, needed only to export in batches, or optional (skipped when
// it cannot be found). Defaults are fallbacks for the pages as last known;
// a taught locator always comes first.
const WOS_STEPS = [
  { id: 'query', label: 'Query box', mode: 'fill', defaults: [{ id: 'advancedSearchInputArea' }, { tag: 'textarea', css: 'textarea' }] },
  { id: 'search', label: 'Search button', mode: 'click', defaults: [{ testid: ['data-ta', 'run-search'] }, { tag: 'button', text: 'Search', dialog: false }] },
  { id: 'count', label: 'Result count', mode: 'read', defaults: [{ testid: ['data-ta', 'search-info-hits'] }, { css: 'h1 .brand-blue' }] },
  { id: 'export', label: 'Export button', mode: 'click', defaults: [{ id: 'export-trigger-btn' }, { tag: 'button', text: 'Export', dialog: false }] },
  { id: 'format', label: 'RIS format', mode: 'click', defaults: [{ id: 'exportToRisButton' }, { text: 'RIS (other reference software)' }] },
  { id: 'range', label: 'Record range option', mode: 'click', check: true, when: 'always', defaults: [{ id: 'radio3-input' }, { text: 'Records from:', dialog: true }] },
  { id: 'from', label: 'Range start', mode: 'fill', when: 'always', defaults: [{ name: 'markFrom' }, { aria: 'Input starting record range' }] },
  { id: 'to', label: 'Range end', mode: 'fill', when: 'always', defaults: [{ name: 'markTo' }, { aria: 'Input ending record range' }] },
  { id: 'content', label: 'Record content menu', mode: 'click', when: 'optional', defaults: [] },
  { id: 'contentOption', label: 'Full record option', mode: 'click', when: 'optional', after: 'content', defaults: [{ role: 'option', text: 'Full Record' }] },
  { id: 'confirm', label: 'Confirm export', mode: 'click', defaults: [{ id: 'exportButton' }, { tag: 'button', text: 'Export', dialog: true }] },
];
const SCOPUS_STEPS = [
  { id: 'query', label: 'Query box', mode: 'fill', defaults: [{ id: 'searchfield' }, { tag: 'textarea', css: 'textarea' }, { css: '[contenteditable=true]' }] },
  { id: 'search', label: 'Search button', mode: 'click', defaults: [{ id: 'advSearch' }, { tag: 'button', text: 'Search', dialog: false }] },
  { id: 'count', label: 'Result count', mode: 'read', defaults: [{ testid: ['data-testid', 'results-count'] }, { css: 'h1.documentHeader .resultsCount' }] },
  { id: 'export', label: 'Export button', mode: 'click', defaults: [{ tag: 'button', text: 'Export', dialog: false }, { aria: 'Export' }] },
  { id: 'format', label: 'RIS format', mode: 'click', defaults: [{ text: 'RIS' }, { text: 'RIS format' }] },
  { id: 'range', label: 'Document range option', mode: 'click', check: true, when: 'batch', defaults: [{ text: 'Documents from', dialog: true }] },
  { id: 'from', label: 'Range start', mode: 'fill', when: 'batch', defaults: [{ aria: 'From', dialog: true }, { placeholder: 'From' }] },
  { id: 'to', label: 'Range end', mode: 'fill', when: 'batch', defaults: [{ aria: 'To', dialog: true }, { placeholder: 'To' }] },
  { id: 'content', label: 'Abstract option', mode: 'click', check: true, when: 'optional', defaults: [{ text: 'Abstract & keywords', dialog: true }] },
  { id: 'confirm', label: 'Confirm export', mode: 'click', defaults: [{ tag: 'button', text: 'Export', dialog: true }] },
];

export const SITES = [
  { id: 'wos', name: 'Web of Science', kind: 'database', target: 'wos', batch: 1000, maxBatch: 1000, steps: WOS_STEPS,
    loginHosts: ['access.clarivate.com', 'login.webofknowledge.com'],
    countPatterns: ['(\\d[\\d,.\\s]*)\\s+results?\\s+from', '(\\d[\\d,.\\s]*)\\s+results?\\b'],
    hint: 'Advanced search, e.g. TS=(glioma OR astrocytoma) AND PY=(2015-2025)',
    tags: [['Topic', 'TS=()'], ['Title', 'TI=()'], ['Abstract', 'AB=()'], ['Author', 'AU=()'], ['Author keywords', 'AK=()'],
      ['Source', 'SO=()'], ['Year', 'PY=()'], ['Document type', 'DT=()'], ['Language', 'LA=()']] },
  { id: 'scopus', name: 'Scopus', kind: 'database', target: 'scopus', batch: 2000, maxBatch: 20000, steps: SCOPUS_STEPS,
    loginHosts: ['id.elsevier.com'],
    countPatterns: ['(\\d[\\d,.\\s]*)\\s+documents?\\s+found', '(\\d[\\d,.\\s]*)\\s+(?:document\\s+)?results?\\b'],
    hint: 'Advanced search, e.g. TITLE-ABS-KEY(glioma OR astrocytoma) AND PUBYEAR > 2014',
    tags: [['Title, abstract, keywords', 'TITLE-ABS-KEY()'], ['Title', 'TITLE()'], ['Abstract', 'ABS()'], ['Author', 'AUTH()'],
      ['Author keywords', 'AUTHKEY()'], ['Source', 'SRCTITLE()'], ['Year', 'PUBYEAR > '], ['Document type', 'DOCTYPE()'], ['Language', 'LANGUAGE()']] },
];
export const siteSource = idOrName => SITES.find(s => s.id === idOrName || s.name === idOrName) || null;

// ---- locators ------------------------------------------------------------
// A locator comes back from the site's page, so it is data from an untrusted
// source: only known keys, only strings of bounded length.
const LOC_KEYS = { tag: 40, id: 120, name: 120, role: 60, placeholder: 120, type: 40, aria: 120, text: 120, css: 300 };
export function sanitizeLocator(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, max] of Object.entries(LOC_KEYS)) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim() && v.length <= max) out[k] = v.replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(raw.testid) && raw.testid.length === 2 && /^data-[a-z-]{1,20}$/.test(raw.testid[0]) &&
      typeof raw.testid[1] === 'string' && raw.testid[1].length <= 120) out.testid = [raw.testid[0], raw.testid[1]];
  if (typeof raw.dialog === 'boolean') out.dialog = raw.dialog;
  if (out.tag && !/^[a-z][a-z0-9-]*$/.test(out.tag)) delete out.tag;
  const strong = ['id', 'name', 'aria', 'placeholder', 'text', 'css', 'testid'].some(k => out[k] != null);
  return strong ? out : null;
}

/** A locator as one line a person can read in the teach list. */
export function describeLocator(loc) {
  if (!loc) return '';
  const what = loc.aria || loc.text || loc.placeholder || loc.name || loc.id || (loc.testid && loc.testid[1]) || loc.css || '';
  return `${loc.tag || 'element'}${what ? ` “${what.length > 40 ? `${what.slice(0, 39)}…` : what}”` : ''}`;
}

// App settings, not project settings: where a site's buttons are is a fact
// about the site and this machine, the same for every review.
const STORE_KEY = 'lykos.site-search.v1';
export const DEFAULT_SETTINGS = { pause: 200, wait: 20 };
function storage(store) {
  if (store) return store;
  try { return globalThis.localStorage || null; } catch { return null; }
}
export function loadSiteSettings(store) {
  let saved = null;
  try { saved = JSON.parse(storage(store)?.getItem(STORE_KEY) || 'null'); } catch { saved = null; }
  const out = { ...DEFAULT_SETTINGS, sites: {} };
  if (saved && typeof saved === 'object') {
    if (Number.isFinite(saved.pause)) out.pause = Math.min(5000, Math.max(0, Math.round(saved.pause)));
    if (Number.isFinite(saved.wait)) out.wait = Math.min(300, Math.max(3, Math.round(saved.wait)));
    for (const site of SITES) {
      const s = saved.sites?.[site.id];
      if (!s || typeof s !== 'object') continue;
      const taught = {};
      for (const step of site.steps) { const loc = sanitizeLocator(s.taught?.[step.id]); if (loc) taught[step.id] = loc; }
      const batch = Number(s.batch);
      out.sites[site.id] = { taught, ...(Number.isInteger(batch) && batch >= 1 && batch <= site.maxBatch ? { batch } : {}) };
    }
  }
  return out;
}
export function saveSiteSettings(settings, store) {
  try { storage(store)?.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
export function teachStep(settings, siteId, stepId, locator) {
  const loc = sanitizeLocator(locator);
  if (!loc) return false;
  settings.sites[siteId] ||= { taught: {} };
  settings.sites[siteId].taught ||= {};
  settings.sites[siteId].taught[stepId] = loc;
  return true;
}
export function resetSite(settings, siteId, stepId = null) {
  const s = settings.sites[siteId];
  if (!s) return;
  if (stepId) delete s.taught?.[stepId]; else s.taught = {};
}
/** Candidates for a step, the taught one first. */
export function locatorsFor(site, settings, stepId) {
  const step = site.steps.find(s => s.id === stepId);
  const taught = settings.sites?.[site.id]?.taught?.[stepId];
  return [...(taught ? [taught] : []), ...(step?.defaults || [])];
}
export const batchSize = (site, settings) => settings.sites?.[site.id]?.batch || site.batch;

/** Record ranges for an export: [[1, 1000], [1001, 2000], ...]. */
export function batches(total, size) {
  const out = [];
  for (let from = 1; from <= total; from += size) out.push([from, Math.min(total, from + size - 1)]);
  return out;
}

// ---- a run -----------------------------------------------------------------
export class Stopped extends Error { constructor() { super('Stopped'); this.name = 'AbortError'; } }

/**
 * Runs one search. `bridge` is the shell: open(siteId, navigate), page(action,
 * args), downloads(), take(id), sleep(ms). `onState` receives progress;
 * `resume()` resolves when the user presses Continue. Returns
 * { total, files: [{ name, text, range }], complete }.
 */
export async function runSite({ site, query, bridge, settings, onState = () => {}, resume = () => new Promise(() => {}), signal, exportRecords = true }) {
  const aborted = new Promise(r => signal?.addEventListener('abort', r, { once: true }));
  const sleep = ms => Promise.race([bridge.sleep(ms), aborted]);
  const userContinue = () => Promise.race([resume(), aborted]);
  const pause = () => sleep(settings.pause);
  const stop = () => { if (signal?.aborted) throw new Stopped(); };
  let total = null;
  const files = [];
  const say = (message, extra = {}) => onState({ message, ...extra });
  const step = id => site.steps.find(s => s.id === id);
  const evalSafe = async (action, args) => { try { return await bridge.page(action, args); } catch { return null; } };

  // Waits until the page needs nothing from the user: signed in, no check.
  async function clear() {
    for (;;) {
      stop();
      const p = await evalSafe('probe', { loginHosts: site.loginHosts });
      const why = !p ? '' : p.captcha ? 'check' : p.login ? 'login' : p.problem ? 'problem' : '';
      if (!why) return p;
      say(why === 'check' ? `Complete the check in the ${site.name} window` : why === 'login' ? `Sign in to ${site.name} in its window`
        : `${site.name}: ${p.problem}`, { needsUser: why });
      await Promise.race([userContinue(), sleep(1500)]);
    }
  }
  // Finds a step's element, waiting for slow pages. A missing required step
  // hands over to the user (to teach it or fix the page) and keeps looking.
  async function find(id, { optional = false } = {}) {
    const s = step(id), locs = locatorsFor(site, settings, id);
    if (!locs.length) return optional ? null : waitForUser(id, locs);
    let deadline = Date.now() + (optional ? 3 : settings.wait) * 1000, renavigated = false;
    for (;;) {
      stop();
      await clear();
      const r = await evalSafe('find', { loc: locs });
      if (r?.found) return locs;
      if (Date.now() > deadline) {
        if (optional) return null;
        if (id === 'query' && !renavigated) { renavigated = true; await bridge.open(site.id, true); deadline = Date.now() + settings.wait * 1000; continue; }
        return waitForUser(id, locs, s);
      }
      await sleep(400);
    }
  }
  async function waitForUser(id) {
    const s = step(id);
    say(`${s.label} not found in the ${site.name} window`, { needsUser: 'missing', step: id });
    for (;;) {
      stop();
      const woke = await Promise.race([userContinue().then(() => 'continue'), sleep(1500).then(() => 'tick')]);
      const locs = locatorsFor(site, settings, id);   // re-read: the user may have taught it meanwhile
      const r = locs.length ? await evalSafe('find', { loc: locs }) : null;
      if (r?.found) { say('Continuing'); return locs; }
      if (woke === 'continue') say(`${s.label} not found in the ${site.name} window`, { needsUser: 'missing', step: id });
    }
  }
  async function act(id, args = {}, opts = {}) {
    let locs = await find(id, opts);
    if (!locs) return false;
    const s = step(id);
    for (let attempt = 0; ; attempt++) {
      stop();
      const r = await evalSafe(s.mode === 'fill' ? 'fill' : 'click', { loc: locs, ...(s.check ? { check: true } : {}), ...args });
      if (r?.ok) { await pause(); return true; }
      if (attempt >= 2) { locs = await waitForUser(id); attempt = -1; continue; }
      await sleep(500);
    }
  }

  try {
  say(`Opening ${site.name}`, { phase: 'open' });
  await bridge.open(site.id, true);
  await pause();
  say('Entering the query', { phase: 'search' });
  await act('query', { value: query });
  const before = (await evalSafe('probe', {}))?.url || '';
  await act('search');

  // The count is read on the results page, not the search form.
  say('Reading the result count', { phase: 'count' });
  const countLocs = locatorsFor(site, settings, 'count');
  let deadline = Date.now() + settings.wait * 1000;
  while (total == null) {
    stop();
    const p = await clear();
    const moved = !before || (p && p.url !== before);
    const r = moved || Date.now() > deadline ? await evalSafe('read', { loc: countLocs, patterns: site.countPatterns }) : null;
    if (r && Number.isFinite(r.count)) { total = r.count; break; }
    if (Date.now() > deadline + settings.wait * 1000) { await waitForUser('count'); deadline = Date.now(); continue; }
    await sleep(500);
  }
  say(`${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}`, { phase: 'counted', total });
  if (!exportRecords || total === 0) return { total, files: [], complete: total === 0 };

  const size = batchSize(site, settings);
  const ranged = step('range') && (step('range').when === 'always' || total > size);
  const plan = ranged ? batches(total, size) : [[1, Math.min(total, size)]];
  for (let b = 0; b < plan.length; b++) {
    const [from, to] = plan[b];
    const label = plan.length > 1 ? `batch ${b + 1} of ${plan.length} (${from.toLocaleString()}–${to.toLocaleString()})` : `${to.toLocaleString()} records`;
    for (;;) {
      say(`Exporting ${label}`, { phase: 'export', batch: b + 1, batches: plan.length, total });
      const seen = new Set((await bridge.downloads()).map(d => d.id));
      await act('export');
      await act('format');
      if (step('content') && await act('content', {}, { optional: true }) && step('contentOption'))
        await act('contentOption', {}, { optional: true });
      if (ranged) {
        await act('range');
        await act('from', { value: String(from) });
        await act('to', { value: String(to) });
      }
      await act('confirm');
      const file = await awaitDownload(seen);
      if (file) { files.push({ ...file, range: [from, to] }); onState({ message: `Received ${label}`, phase: 'received', batch: b + 1, batches: plan.length, total, file }); break; }
      say(`No export file arrived for ${label}`, { needsUser: 'download' });
      await userContinue();
    }
    await pause();
  }
  return { total, files, complete: true };
  } catch (err) {
    // What was received before a stop or a failure is still the user's data.
    err.partial = { total, files };
    throw err;
  }

  async function awaitDownload(seen) {
    const until = Date.now() + Math.max(120, settings.wait * 3) * 1000;
    while (Date.now() < until) {
      stop();
      const list = await bridge.downloads();
      const fresh = list.filter(d => !seen.has(d.id));
      const done = fresh.find(d => d.done && d.ok);
      if (done) return { name: done.name, text: String(await bridge.take(done.id)).replace(/^﻿/, '') };
      if (fresh.length && fresh.every(d => d.done && !d.ok)) return null;
      await sleep(500);
    }
    return null;
  }
}

// ---- into the library and the log -------------------------------------------

/** Library records from an export's text, keyed so the same work matches across sources. */
export function exportRecords(site, text) {
  const { records, format, errors } = parseRecords(String(text || '').replace(/^﻿/, ''));
  const slug = r => `${(r.title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}-${r.year || ''}`;
  return {
    format, errors,
    records: records.map(r => {
      const pmid = /PMID:\s*(\d+)/i.exec((r.raw || []).join('\n'))?.[1] || '';
      const key = recordKey({ doi: r.doi, pmid, fallback: r.accession ? `${site.id}-${r.accession.replace(/\s+/g, '')}` : `${site.id}-${slug(r)}` });
      const { database, ...rest } = r;
      return { ...rest, key, id: key, pmid, source: site.name, ...(database ? { database } : {}), pdf: null };
    }),
  };
}

/** The search-log entry for a run: the exact query sent, as B6 asks. */
export function siteLogEntry({ site, query, strategy = '', at, total, retrieved, files = [], stopped = false }) {
  return {
    at, query, ...(strategy && strategy !== query ? { strategy } : {}),
    source: site.name, kind: site.kind, platform: 'Browser session',
    total, retrieved, imported: false,
    status: !stopped && retrieved >= total ? 'complete' : 'partial',
    ...(files.length ? { files: files.map(f => f.name) } : {}),
  };
}

/**
 * Parses the exports of a run and adds them: new records to the library
 * (existing ones matched by key, DOI or PMID are left as they are) and one
 * entry to the search log. Mutates `state` inside the store transaction.
 */
export function importSiteRun(state, { site, query, strategy, at, total, files, stopped = false }) {
  const records = [];
  let unparsed = 0;
  for (const f of files) { const r = exportRecords(site, f.text); records.push(...r.records); unparsed += r.errors || 0; }
  const added = addSearchRecords(state, records);
  const entry = siteLogEntry({ site, query, strategy, at, total: total ?? records.length, retrieved: records.length, files, stopped });
  if (records.length > added) entry.duplicates = records.length - added;   // already in the library: PRISMA's duplicates removed
  state.searches = [...(state.searches || []), entry];
  return { added, retrieved: records.length, unparsed, entry };
}

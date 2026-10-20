// Web of Science and Scopus in the Literature view (plan B1, B5, B6).
//
// With one of them selected the query box holds that site's own advanced
// search syntax. A strategy written for the other sources is translated when
// the source is switched (lib/query-translate.mjs), and what the translation
// changed is listed under the box. In the desktop app the query runs in the
// user's own signed-in session (lib/site-search.mjs, src-tauri/src/site.rs);
// in a browser the site is opened in a tab and its export file imported.
import { num, plural } from '../lib/dates.mjs';
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { inDesktop, siteOpenNative, sitePageNative, siteDownloadsNative, siteTakeDownloadNative } from '../lib/native.mjs';
import { translateQuery } from '../lib/query-translate.mjs';
import { currentId } from '../lib/projects.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { formField } from '../lib/ui-components.mjs';
import {
  runSite, importSiteRun, loadSiteSettings, saveSiteSettings, teachStep, resetSite, locatorsFor,
  describeLocator, batchSize,
} from '../lib/site-search.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bridge = { open: siteOpenNative, page: sitePageNative, downloads: siteDownloadsNative, take: siteTakeDownloadNative, sleep };

// Survives a redraw of the view.
const origins = new Map();        // siteId -> { strategy, query, notes, errors }: the translation in the box
let run = null;                   // { siteId, controller, message, needsUser, resolve }
let lastMessages = {};            // siteId -> how the last run ended
let teach = null;                 // { siteId, stepId, stop, skip }
let teachOpen = false;

/** A strategy translated for a site; remembered so its notes can be shown. */
export function translateInto(siteId, strategy, target = siteId) {
  const t = translateQuery(strategy, target);
  origins.set(siteId, { strategy: String(strategy || ''), query: t.query, notes: t.notes, errors: t.errors });
  return t.query;
}
/** The strategy a site's query was translated from, if it was. */
export const siteStrategy = siteId => origins.get(siteId)?.strategy ?? null;
/** A logged run back in the box: its exact query, and the strategy it came from. */
export function setSiteQuery(siteId, query, strategy = '') {
  if (strategy) { translateInto(siteId, strategy); origins.set(siteId, { ...origins.get(siteId), query: String(query || '') }); }
  else origins.delete(siteId);
}
/**
 * What the box holds when this site is selected: the draft it already had for
 * this strategy, or the strategy from the source being left, translated.
 */
export function siteDraft(site, { fromSite = null, text = '', saved = null } = {}) {
  const strategy = fromSite ? siteStrategy(fromSite.id) : text;
  if (!String(strategy || '').trim()) return saved ?? '';
  if (saved != null && origins.get(site.id)?.strategy === strategy) return saved;
  return translateInto(site.id, strategy, site.target);
}

/**
 * The panel under the query box. Returns { run } for the box's own run
 * button, so the view has one primary action whatever the source.
 */
// Where each site's advanced search opens, for the browser, where the person
// runs the search and brings back the export file.
const SITE_URL = { wos: 'https://www.webofscience.com/wos/woscc/smart-search', scopus: 'https://www.scopus.com/pages/home#basic' };

// What to do on the site, in its own words, for the browser path.
const STEPS = {
  wos: ['Copy the query above', 'Open Web of Science and sign in through your institution', 'Choose Advanced search, paste the query, search',
    'Export, choose RIS, all records, full record', 'Import the export file here'],
  scopus: ['Copy the query above', 'Open Scopus and sign in through your institution', 'Choose Advanced document search, paste the query, search',
    'Select all, Export, choose RIS with abstracts', 'Import the export file here'],
};
const DESKTOP_STEPS = name => [`Window opens ${name}; sign in through your institution there`,
  'Count shows how many records the query finds', `Run in ${name} searches, exports RIS in batches and imports the records`];

export function renderSitePanel(el, { site, box, ctx, onLogged = () => {} }) {
  if (!el) return { run() {} };
  const desktop = inDesktop();
  const settings = loadSiteSettings();
  const busy = !!run && run.siteId === site.id;
  const otherBusy = !!run && !busy;
  const queue = (get().siteQueue || []).filter(q => q.site === site.id);

  const head = uiBar({ kind: 'head', label: site.name, id: 'wos-head', cls: 'panel-head', lead: { title: site.name, level: 'h2' },
    message: { id: 'wos-source', text: desktop ? 'Your signed-in session' : 'Export file' },
    actions: [{ id: 'wos-convert', label: 'Convert tags', icon: 'refresh', role: 'quiet' },
      { id: 'wos-copy', label: 'Copy query', icon: 'copy', role: 'quiet' },
      { id: 'wos-import', label: 'Import export file', icon: 'import', role: 'quiet' },
      ...(desktop ? [{ id: 'wos-teach-toggle', label: 'Teach locators', icon: 'settings', role: 'quiet', pressed: teachOpen }] : [])],
    overflow: desktop ? [{ id: 'wos-window', label: `Show the ${site.name} window`, icon: 'open' }] : [] });
  const message = busy ? run.message : lastMessages[site.id] || '';
  const steps = desktop
    ? (lastMessages[site.id] || busy ? '' : `<ol class="wos-steps" data-ui-help>${DESKTOP_STEPS(site.name).map(x => `<li>${esc(x)}</li>`).join('')}</ol>`)
    : `<ol class="wos-steps" data-ui-help>${(STEPS[site.id] || STEPS.wos).map(x => `<li>${x}</li>`).join('')}</ol>`;
  const runBar = desktop
    ? uiBar({ kind: 'foot', label: 'Run', id: 'wos-run-bar', message: { id: 'wos-status', text: message },
      actions: [{ id: 'wos-queue-add', label: 'Add to queue', icon: 'plus', role: 'secondary' },
        { id: 'wos-count', label: 'Count', role: 'secondary', disabled: busy || otherBusy },
        { id: 'wos-continue', label: 'Continue', role: 'secondary', disabled: !(busy && run.needsUser) },
        { id: 'wos-stop', label: 'Stop', role: 'secondary', disabled: !busy }] })
    : uiBar({ kind: 'foot', label: 'Run', id: 'wos-run-bar', message: { id: 'wos-status', text: message },
      actions: SITE_URL[site.id] ? [{ id: 'wos-open-site', label: `Open ${site.name}`, icon: 'open', role: 'secondary' }] : [] });
  const queueRows = queue.map(q => uiRow({ main: { html: `<span class="wos-queue-query">${esc(q.query)}</span>` },
    end: uiRowEnd({ more: { label: 'More for this query', attrs: { 'data-wos-more': q.id } } }) }));
  const queueBlock = desktop && queue.length ? `<div class="wos-queue">${uiBar({ kind: 'head', label: 'Queue', id: 'wos-queue-head', cls: 'panel-head', lead: { title: 'Queue', level: 'h2' }, message: { id: 'wos-queue-count', text: String(queue.length) },
    actions: [{ id: 'wos-queue-run', label: 'Run queue', icon: 'run', role: 'secondary', disabled: busy || otherBusy }] })}
    ${uiList({ id: 'wos-queue-list', label: 'Queued queries', rows: queueRows })}</div>` : '';
  el.innerHTML = `<div class="panel wos-panel" data-site="${esc(site.id)}">${head}
    <div class="panel-body wos-body">
      <div id="wos-notes"></div>
      ${steps}${runBar}
    </div>
    ${queueBlock}
    ${desktop && teachOpen ? teachMarkup(site, settings) : ''}
  </div>`;

  const status = msg => { const s = el.querySelector('#wos-status'); if (s) s.textContent = msg; };
  const redraw = () => renderSitePanel(el, { site, box, ctx, onLogged });
  // What the translation changed, while the box still holds that translation.
  const paintNotes = () => {
    const o = origins.get(site.id), n = el.querySelector('#wos-notes');
    if (!n) return;
    const text = box.value.trim();
    if (!o || !text) { n.innerHTML = ''; return; }
    const same = o.query === text;
    n.innerHTML = `${o.errors.length ? `<div class="wos-errors">${o.errors.map(e => `<span class="status failed">${icon('warn')}${esc(e)}</span>`).join('')}</div>` : ''}
      <div class="wos-edited meta">${same ? 'Translated' : 'Edited after translation'}${same ? '' : ' <button class="link" id="wos-retranslate">Translate again</button>'}</div>
      ${same && o.notes.length ? `<ul class="wos-notes">${o.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    n.querySelector('#wos-retranslate')?.addEventListener('click', () => setBox(translateInto(site.id, o.strategy, site.target)));
  };
  const setBox = text => { box.value = text; box.dispatchEvent(new Event('input')); paintNotes(); };
  if (!box.dataset.wosNotes) {
    box.dataset.wosNotes = '1';
    let timer = null;
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => el.isConnected && paintNotes(), 150); });
  }
  paintNotes();

  el.querySelector('#wos-open-site')?.addEventListener('click', () => window.open(SITE_URL[site.id], '_blank', 'noopener'));
  el.querySelector('#wos-convert').onclick = () => { if (box.value.trim()) setBox(translateInto(site.id, box.value, site.target)); };
  el.querySelector('#wos-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(box.value.trim()); status('Query copied'); } catch { box.select(); status('Select and copy the query'); }
  };
  el.querySelector('#wos-import').onclick = () => pickFiles(async files => {
    const texts = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
    let out = null;
    const query = box.value.trim();
    update(st => { out = importSiteRun(st, { site, query, strategy: origins.get(site.id)?.strategy || '', at: new Date().toISOString(), total: null, files: texts }); return st; });
    lastMessages = { ...lastMessages, [site.id]: `${out.retrieved} retrieved, ${out.added} new${out.unparsed ? `, ${out.unparsed} unparsed` : ''}` };
    status(lastMessages[site.id]);
    onLogged();
  });
  const one = () => [{ query: box.value.trim(), strategy: origins.get(site.id)?.strategy || '' }];
  const api = {
    run() {
      if (!desktop) { window.open(SITE_URL[site.id], '_blank', 'noopener'); return; }
      if (!box.value.trim()) { status('Enter a query'); return; }
      start(site, one(), true);
    },
  };
  if (!desktop) return api;

  el.querySelector('#wos-window').onclick = () => siteOpenNative(site.id, false).catch(err => status(err.message || String(err)));
  el.querySelector('#wos-teach-toggle').onclick = () => { teachOpen = !teachOpen; redraw(); };
  el.querySelector('#wos-stop').onclick = () => run?.controller.abort();
  el.querySelector('#wos-continue').onclick = () => { if (run?.resolve) { const r = run.resolve; run.resolve = null; r(); } };
  el.querySelector('#wos-count').onclick = () => { if (box.value.trim()) start(site, one(), false); else status('Enter a query'); };
  el.querySelector('#wos-queue-add').onclick = () => {
    const [item] = one();
    if (!item.query) { status('Enter a query'); return; }
    update(st => { st.siteQueue = [...(st.siteQueue || []), { id: `q${Date.now().toString(36)}`, site: site.id, ...item }]; return st; });
    redraw();
  };
  el.querySelector('#wos-queue-run')?.addEventListener('click', () => start(site, queue, true));
  el.querySelectorAll('[data-wos-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove from queue', icon: 'trash', danger: true, run: () => {
    update(st => { st.siteQueue = (st.siteQueue || []).filter(q => q.id !== b.dataset.wosMore); return st; });
    redraw();
  } }], { align: 'end' }));
  if (teachOpen) wireTeach(el, site, settings, redraw);
  return api;

  async function start(siteNow, items, exportAll) {
    if (run) return;
    const controller = new AbortController();
    const project = currentId();
    run = { siteId: siteNow.id, controller, message: '', needsUser: '', resolve: null };
    const resume = () => new Promise(r => { if (run) run.resolve = r; });
    setRunning(siteNow.id, true);
    let last = '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prefix = items.length > 1 ? `Query ${i + 1} of ${items.length} · ` : '';
      const at = new Date().toISOString();
      let result = null, error = null;
      try {
        result = await runSite({ site: siteNow, query: item.query, bridge, settings: loadSiteSettings(), signal: controller.signal, exportRecords: exportAll, resume,
          onState: s => { if (!run) return; run.message = `${prefix}${s.message}`; run.needsUser = s.needsUser || ''; paintRun(); } });
      } catch (err) { error = err; result = err.partial || null; }
      if (!exportAll) {
        last = error ? (error.name === 'AbortError' ? 'Stopped' : error.message)
          : `${plural(result.total, 'record')} in ${siteNow.name}`;
        break;
      }
      if (result?.files?.length || (result && result.total === 0 && !error)) {
        if (currentId() !== project) { last = 'Project changed during the run; the export files are kept in the app data folder'; break; }
        let out = null;
        update(st => { out = importSiteRun(st, { site: siteNow, query: item.query, strategy: item.strategy, at, total: result.total, files: result.files, stopped: !!error }); return st; });
        onLogged();
        last = `${prefix}${num(out.retrieved)} of ${num(result.total)} retrieved, ${num(out.added)} new${error ? ' · stopped' : ''}`;
      } else if (error) last = `${prefix}${error.name === 'AbortError' ? 'Stopped' : error.message}`;
      if (error) break;
    }
    lastMessages = { ...lastMessages, [siteNow.id]: last };
    run = null;
    setRunning(siteNow.id, false);
    const live = document.querySelector(`.wos-panel[data-site="${siteNow.id}"]`);
    if (live) { const s = live.querySelector('#wos-status'); if (s) s.textContent = last; }
  }
}

/** Enables and disables in place: a run's controls never redraw the panel. */
function setRunning(siteId, on) {
  const el = document.querySelector(`.wos-panel[data-site="${siteId}"]`);
  const set = (sel, disabled) => { const b = document.querySelector(sel); if (b) b.disabled = disabled; };
  set('#run', on);
  if (!el) return;
  set('#wos-count', on); set('#wos-stop', !on); set('#wos-continue', true); set('#wos-queue-run', on);
  el.querySelectorAll('[data-wos-teach],#wos-teach-all').forEach(b => { b.disabled = on; });
}

function paintRun() {
  // The view may have been redrawn since the run began: find the live panel.
  const el = run && document.querySelector(`.wos-panel[data-site="${run.siteId}"]`);
  if (!el) return;
  const s = el.querySelector('#wos-status');
  if (s) s.textContent = run?.message || '';
  const c = el.querySelector('#wos-continue');
  if (c) c.disabled = !run?.needsUser;
}

function teachMarkup(site, settings) {
  const taught = settings.sites?.[site.id]?.taught || {};
  const active = teach && teach.siteId === site.id ? teach.stepId : null;
  return `<div class="wos-teach">
    ${uiBar({ kind: 'head', label: 'Locators', id: 'wos-teach-head', cls: 'panel-head', lead: { title: 'Locators', level: 'h2' },
      actions: [{ id: 'wos-teach-all', label: 'Teach all', role: 'secondary', disabled: !!(teach || run) },
        { id: 'wos-teach-stop', label: 'Stop teaching', role: 'secondary', disabled: !teach }],
      overflow: [{ id: 'wos-teach-reset', label: 'Reset all locators', danger: true }] })}
    <table><tbody>${site.steps.map(s => `<tr${active === s.id ? ' class="wos-teaching"' : ''}>
      <td class="wos-step">${esc(s.label)}${s.when === 'optional' ? ' <span class="meta">Optional</span>' : ''}</td>
      <td class="grow meta">${active === s.id ? 'Waiting for a click' : taught[s.id] ? esc(describeLocator(taught[s.id])) : locatorsFor(site, settings, s.id).length ? 'Default' : 'Not set'}</td>
      <td class="wos-step-acts">${active === s.id ? `<button data-wos-skip="${s.id}">Skip</button>`
        : `<button data-wos-teach="${s.id}"${teach || run ? ' disabled' : ''}>Teach</button>`}
        <button data-wos-reset="${s.id}"${taught[s.id] ? '' : ' disabled'}>Reset</button></td></tr>`).join('')}</tbody></table>
    <div class="an-settings">
      ${formField('Batch size', `<input inputmode="numeric" autocomplete="off" id="wos-batch" value="${batchSize(site, settings)}">`)}
      ${formField('Pause (ms)', `<input inputmode="numeric" autocomplete="off" id="wos-pause" value="${settings.pause}">`)}
      ${formField('Wait (s)', `<input inputmode="numeric" autocomplete="off" id="wos-wait" value="${settings.wait}">`)}
    </div></div>`;
}

function wireTeach(el, site, settings, redraw) {
  const save = () => saveSiteSettings(settings);
  el.querySelector('#wos-batch').onchange = e => {
    const n = Math.round(Number(e.target.value));
    settings.sites[site.id] ||= { taught: {} };
    if (n >= 1 && n <= site.maxBatch) settings.sites[site.id].batch = n; else delete settings.sites[site.id].batch;
    save(); redraw();
  };
  el.querySelector('#wos-pause').onchange = e => { const n = Number(e.target.value); if (n >= 0) { settings.pause = Math.min(5000, Math.round(n)); save(); } redraw(); };
  el.querySelector('#wos-wait').onchange = e => { const n = Number(e.target.value); if (n >= 3) { settings.wait = Math.min(300, Math.round(n)); save(); } redraw(); };
  el.querySelector('#wos-teach-reset').onclick = () => { resetSite(settings, site.id); save(); redraw(); };
  el.querySelectorAll('[data-wos-reset]').forEach(b => b.onclick = () => { resetSite(settings, site.id, b.dataset.wosReset); save(); redraw(); });
  el.querySelectorAll('[data-wos-teach]').forEach(b => b.onclick = () => teachSteps(site, [b.dataset.wosTeach], redraw));
  el.querySelector('#wos-teach-all').onclick = () => teachSteps(site, site.steps.map(s => s.id), redraw);
  el.querySelector('#wos-teach-stop').onclick = () => { if (teach) teach.stop = true; };
  el.querySelectorAll('[data-wos-skip]').forEach(b => b.onclick = () => { if (teach) teach.skip = true; });
}

/**
 * Walks the user through the steps: each is armed in the site window, the
 * user clicks the element (the click still happens, so the walk-through
 * reaches the next page), and the recorded locator is saved.
 */
async function teachSteps(site, ids, redraw) {
  if (teach || run) return;
  try { await siteOpenNative(site.id, false); } catch { return; }
  teach = { siteId: site.id, stepId: null, stop: false, skip: false };
  try {
    for (const id of ids) {
      const step = site.steps.find(s => s.id === id);
      teach.stepId = id; teach.skip = false; redraw();
      for (;;) {
        if (teach.stop || teach.skip) break;
        const r = await sitePageNative('teach_read', {}).catch(() => null);
        if (r?.result?.step === id) {
          const settings = loadSiteSettings();
          if (teachStep(settings, site.id, id, r.result.locator)) { saveSiteSettings(settings); break; }
        }
        // A new page drops the listener; arm it again.
        if (r && !r.armed) await sitePageNative('teach_arm', { step: id, mode: step.mode }).catch(() => null);
        await sleep(400);
      }
      if (teach.stop) break;
    }
  } finally {
    await sitePageNative('teach_stop', {}).catch(() => null);
    teach = null;
    redraw();
  }
}

function pickFiles(fn) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.ris,.txt,.bib,.bibtex,.json'; i.multiple = true; i.hidden = true;
  document.body.appendChild(i);
  i.onchange = async () => { try { if (i.files.length) await fn([...i.files]); } finally { i.remove(); } };
  i.oncancel = () => i.remove();
  i.click();
}

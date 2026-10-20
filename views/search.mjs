// Search: several bibliographic sources behind one query box (plan B1).
//
// The exact query, when it ran, the total reported and the number actually
// retrieved are recorded. A partial download is marked incomplete rather than
// counted as complete (plan B6) — the difference decides what a review may claim.
import { REGISTRY } from './registry.mjs';
import * as aid from '../lib/aid.mjs';
import '../aid/search.mjs';   // this page's own model actions (aid.actionsFor below reads them); the other pages' load with the first use (lib/aid.mjs ensureAid)
import { pagedItems, wireDataPager, resetPagedList } from '../lib/list-pager.mjs';
import { pagerBar } from '../lib/paging.mjs';
import { uiBar, uiGroup, uiList, uiRow, uiRowEnd, uiStatusLine } from '../lib/ui-actions.mjs';
import { watchNarrow } from '../lib/narrow.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { when, num, plural } from '../lib/dates.mjs';
import { showMenu } from '../lib/menu.mjs';
import { showSubset, focusPaper, pick, importRecords, IMPORT_ACCEPT } from './library.mjs';
import { OUTSIDE_DATABASES, outsideEntry, mergeImported } from '../lib/search-outside.mjs';
import { dateField, wireDateField } from '../lib/date-picker.mjs';
import { formField } from '../lib/ui-components.mjs';
import { hasQuerySyntax, queryDiagram, wireQueryDiagrams } from '../lib/query-view.mjs';
import * as coll from '../lib/collections.mjs';
import { libraryIndex, canAddResult, addSearchRecords, libraryRecord } from '../lib/search-library.mjs';
import { addAll, isDuePaused } from '../lib/search-run.mjs';
import { onBudget } from '../lib/limiter.mjs';
import { running } from '../lib/jobs.mjs';
import { confirmAsk, formDialog, formValues } from '../lib/dialog.mjs';
import { get, update, getVersion, projects } from '../store.mjs';
import { parseQuery, stats as queryStats } from '../lib/boolean.mjs';
import { draftQuery } from '../lib/assistant.mjs';
import { configured } from '../lib/ai.mjs';
import { esc, autoGrow, emptyState } from '../lib/html.mjs';
import { authorLine, authorList, journalShort } from '../lib/bib.mjs';
import { icon } from '../lib/icons.mjs';
import { settings, modelFor } from '../lib/model-settings.mjs';
import { inDesktop, inHostedTab } from '../lib/native.mjs';
import { SOURCES, source as sourceOf, runSearch, openalexBudget } from '../lib/sources.mjs';
import { schedules, add as addSchedule, INTERVALS } from '../lib/schedule.mjs';
import { siteSource, SITES as ALL_SITES } from '../lib/site-search.mjs';
// Web of Science and Scopus run in the desktop app's own browser window (views/site-search.mjs): a hosted tab does not offer them.
const SITES = inHostedTab() ? [] : ALL_SITES;
import { renderSitePanel, setSiteQuery, siteDraft, siteStrategy, translateInto } from './site-search.mjs';
import { renderChase, chaseStatus } from './citation-chase.mjs';
import { renderSeeds, seedsStatus } from './seed-records.mjs';
import { renderStrategy } from './search-strategy.mjs';
import { renderLiving, livingPage } from './living-review.mjs';

export const meta = { title: 'Literature', icon: 'literature' };
export const count = (...a) => REGISTRY.search.count(...a);

// The Literature tools: the title bar's view switch (page()), so the workspace keeps the full width for research.
const TOOL_LABELS = [
  ['search', 'Search'], ['chase', 'Citation chasing'], ['seeds', 'Seed records'],
  ['strategy', 'Strategy'], ['living', 'Living review'],
];
const TOOLS = TOOL_LABELS.map(([id]) => id);
export function select(id) { if (TOOLS.includes(id)) mode = id; }
/** Arrival from Needs attention (lib/arrive.mjs): a search not fully retrieved is in the search log, on the Search tool. */
export function arrive(a) { if (a?.kind === 'partial-search' || a?.kind === 'first-search') mode = 'search'; return false; }
export function selected() { syncState(); return mode; }

const PAGE = 25;
const SOURCE_ICONS = { pubmed: 'pubmed.ico', epmc: 'europepmc.png', crossref: 'crossref.ico', openalex: 'openalex.png', ctgov: 'ctg.svg', wos: 'wos.ico', scopus: 'scopus.png' };
const sourceImage = id => `<img class="source-favicon" src="./assets/sources/${SOURCE_ICONS[id]}" alt="" width="20" height="20">`;
// Field tags are PubMed's syntax, so the buttons only appear for PubMed.
const TAGS = [
  ['Title/Abstract', '[tiab]'], ['Title', '[ti]'], ['Author', '[au]'],
  ['Journal', '[ta]'], ['MeSH', '[mh]'], ['Type', '[pt]'],
];

let results = [], chosen = new Set(), lastQuery = '', activeQuery = '', total = 0;
let sourceId = 'pubmed', pageIndex = 0, destination = '';
const sourceCache = new Map();
// What is typed in the box, which is not yet the query that ran: paging
// continues lastQuery, while a redraw keeps what the person typed.
let draft = null;

/** What the person is looking at: the query in the box and the source it goes to. */
export function focus() {
  syncState();
  const box = document.querySelector('#q');
  const text = String(box ? box.value : draft ?? lastQuery).trim();
  const src = siteSource(sourceId) || sourceOf(sourceId);
  return { kind: 'query', source: src.id, label: src.name, text, detail: text ? '' : 'empty box' };
}
/**
 * Puts an accepted query in the box, and switches source when one is named.
 * Nothing runs: a search is a recorded action, so the person issues it.
 */
export function loadQuery(q, srcId) {
  syncState();
  if (srcId && srcId !== sourceId && [...SOURCES, ...SITES].some(o => o.id === srcId)) {
    sourceId = srcId; results = []; chosen = new Set(); total = 0; runIndex = null;
  }
  mode = 'search'; draft = String(q || '');
  const box = document.querySelector('#q');
  if (box) { box.value = draft; box.dispatchEvent(new Event('input')); }
}
/** The query in the box (or the draft kept while another tool is open) and the source it goes to. */
export function currentQuery() {
  syncState();
  const box = document.querySelector('#q'), src = siteSource(sourceId) || sourceOf(sourceId);
  return { text: String(box ? box.value : draft ?? lastQuery).trim(), label: src.name, source: src.id };
}
/** Adds text on a line of its own to the query, for the person to place. */
export function appendToQuery(text) {
  syncState();
  const cur = String(document.querySelector('#q')?.value ?? draft ?? lastQuery ?? '').trim();
  draft = cur ? `${cur}\n${text}` : String(text);
}
/** Puts a whole query in the box (from a tool that built it). */
export function replaceQuery(text) { syncState(); draft = String(text || ''); }
const NARROW_RESULTS = 640;   // px: the results table's five columns no longer fit beside the title
let mode = 'search';   // which of the Literature tools is open (the rail's selection)
let searchState = projects().current, searchSerial = 0;

// Keyed to the project, not the state object: another tab's save replaces
// that object, and must not throw away the query typed here.
function syncState() {
  const current = projects().current;
  if (searchState === current) return;
  searchState = current;
  results = []; chosen = new Set(); lastQuery = ''; activeQuery = '';
  total = 0; sourceId = 'pubmed'; pageIndex = 0; destination = ''; draft = null; sourceCache.clear(); runIndex = null; mode = 'search'; searchSerial++;
}

export function selection() {
  syncState();
  if (chosen.size !== 1) return null;
  const record = results.find(r => chosen.has(r.key));
  return record ? { ...record, source: sourceOf(sourceId).name } : null;
}

/** What the assistant is told about this view: the query in the box and the log. */
export function assistContext() {
  syncState();
  const runs = (get().searches || []).slice(-5);
  return [`Search: query in the box: ${lastQuery || '(empty)'}`,
    `${chosen.size} results selected; ${results.length} loaded of ${total} reported`,
    runs.length ? `Recent runs: ${runs.map(r => `${r.source || 'PubMed'} "${r.query}" → ${r.total ?? r.retrieved ?? '?'}`).join('; ')}` : 'No searches run'].join('\n');
}
let runIndex = null;   // the log entry this search owns, so paging updates it

// The log pages ten runs at a time, newest first.
const LOG_PAGE = 10;

/** The library's records a logged search brought in: those that name its database. */
function runRecords(r) {
  const src = String(r.source || 'PubMed').toLowerCase();
  return (get().papers || []).filter(p => [p.source, p.database, ...(p.databases || [])].some(d => String(d || '').toLowerCase() === src));
}
function logDetail(r, i) {
  const list = runRecords(r);
  const bar = uiBar({ kind: 'tools', label: 'Records of this search', id: `log-detail-bar-${i}`, message: { id: `log-detail-count-${i}`, text: `${plural(list.length, 'record')} in the library` },
    actions: list.length ? [{ id: `log-library-${i}`, label: 'Show in Library', icon: 'library', role: 'quiet', attrs: { 'data-log-library': i } }] : [] });
  const pg = pagedItems(list, `search-log-records-${i}`, PAGE);
  const rows = list.length ? uiList({ id: `log-records-${i}`, label: 'Records of this search', cls: 'log-records', rows: pg.items.map(p => uiRow({ cls: 'lr-row', attrs: { 'data-log-paper': p.id, tabindex: 0 },
    main: { html: `<span class="lr-title">${esc(p.title || '')}</span>`, detail: [esc(p.label || ''), esc(journalShort(p) || '')] } })) }) : '';
  return `<div class="log-detail" role="listitem" data-detail="${i}">${bar}${rows}</div>`;
}
// The log's head is drawn before the first search too: Log a search… records one run outside Lykos (lib/search-outside.mjs).
function logMarkup(runs) {
  const exploratory = runs.filter(r => r.exploratory && r.status !== 'failed').length;
  const pg = pagedItems(runs.map((r, i) => [r, i]).reverse(), 'search-log', LOG_PAGE);
  return `<div class="panel search-log">${uiBar({ kind: 'head', label: 'Search log', id: 'log-head', lead: { title: 'Search log', level: 'h2' },
      message: { id: 'log-count', text: [plural(runs.length, 'run'), exploratory ? `${exploratory} not in PRISMA` : ''].filter(Boolean).join(' · ') },
      actions: [{ id: 'log-outside', label: 'Log a search…', icon: 'plus', role: 'quiet' }] })}
    ${runs.length ? `<div class="panel-body tight">${uiList({ id: 'search-log-list', label: 'Search log', cols: ['source', 'result'], rows: pg.items.map(([r, i]) => logRow(r, i)) })}</div>` : ''}</div>`;
}

/** Log a search… : a run in another database, by hand; Log and import file… also brings its export's records in. */
async function logOutside(ctx) {
  const body = `<datalist id="outside-dbs">${OUTSIDE_DATABASES.map(d => `<option value="${esc(d)}"></option>`).join('')}</datalist>
    ${formField('Database', '<input name="source" list="outside-dbs" autocomplete="off" aria-label="Database">')}
    <label class="field ui-field"><span>Date run</span>${dateField('outside-day', new Date().toISOString().slice(0, 10), 'Date run')}</label>
    ${formField('Strategy', '<textarea name="query" rows="5" spellcheck="false" aria-label="Strategy as run"></textarea>')}
    ${formField('Records found', '<input name="found" inputmode="numeric" autocomplete="off" aria-label="Records found">')}
    <p class="ask-error meta" data-outside-error aria-live="polite"></p>`;
  const read = d => {
    const v = formValues(d.querySelector('form')), r = outsideEntry({ ...v, day: d.querySelector('#outside-day')?.value || '' });
    d.querySelector('[data-outside-error]').textContent = r.error || '';
    return r.entry;
  };
  const log = entry => { update(s => { s.searches = [...(s.searches || []), entry]; return s; }); ctx.rerender(); };
  await formDialog({ id: 'search-outside', title: 'Log a search', tier: 'M', confirm: 'Log search', body,
    start: { id: 'outside-import', label: 'Log and import file…' },
    onMount: d => { wireDateField(d, 'outside-day', 'Date run'); d.querySelector('form').addEventListener('input', () => { d.querySelector('[data-outside-error]').textContent = ''; }); },
    submit: (form, d) => { const e = read(d); if (!e) return undefined; log(e); return e; },
    // Logged before the file is chosen, so a cancelled picker keeps the search; a chosen file's import then merges into it.
    onAct: (act, d, close) => {
      const e = read(d); if (!e) return true;
      const at = (get().searches || []).length;
      log(e);
      pick({ accept: IMPORT_ACCEPT }, async files => {
        await importRecords(files[0], msg => { if (msg) ctx.rerender(msg); });
        update(s => { const all = s.searches || [], i = all.indexOf(all.find((x, n) => n >= at && x.outside && x.query === e.query && x.at === e.at));
          if (i >= 0) s.searches = mergeImported([...all.slice(0, i), ...all.slice(i + 1)], i, e); return s; });
        ctx.rerender(); ctx.refreshCounts?.();
      });
      close(e); return true;
    } });
}
/** One logged run: its query as structure, the date, where it ran and what it found, and one More for what can be done with it. */
function logRow(r, i) {
  const sched = schedules().find(x => x.query === r.query && x.sourceName === (r.source || 'PubMed'));
  const detail = [esc(when(r.at)), sched ? esc(INTERVALS.find(x => x.id === sched.interval)?.label || 'Repeats') : r.scheduled ? 'Scheduled' : '',
    r.paused ? esc(isDuePaused(r) ? 'Ready to resume' : `Resumes ${when(r.paused.resumeAt)}`) : ''];
  return uiRow({ cls: 'log-row', attrs: { 'data-log': i, tabindex: 0, 'aria-expanded': 'false' },
    main: { html: queryCell(r), detail, wrap: true },
    cells: [{ col: 'source', kind: 'text', ch: 14, html: esc(r.source || 'PubMed') }, { col: 'result', kind: 'text', ch: 24, html: statusCell(r) }],
    end: r.paused ? uiRowEnd({ primary: { id: `log-resume-${i}`, label: 'Resume', attrs: { 'data-resume': i } }, more: { label: `More for the ${r.source || 'PubMed'} search`, attrs: { 'data-log-more': i } } })
      : uiRowEnd({ more: { label: `More for the ${r.source || 'PubMed'} search`, attrs: { 'data-log-more': i } } }) });
}

// ---- the query's structure, in the inspector ------------------------------------------------------------------------------------------
let outlineHost = null;
function outlineHtml(text) {
  const { tree, errors } = parseQuery(text);
  const st = queryStats(tree);
  const node = n => {
    if (!n) return '';
    if (n.term != null) return `<div class="bq-term"><span>${esc(n.term)}${n.proximity != null ? `<span class="bq-prox">~${n.proximity}</span>` : ''}</span>${
      n.field ? `<span class="bq-field">${esc(n.field)}</span>` : ''}</div>`;
    return `<div class="bq-group${n.mixed ? ' mixed' : ''}"><div class="bq-op">${n.op}${n.mixed ? ' <span class="bq-warn">mixed, read left to right</span>' : ''}${
      n.op !== 'NOT' ? ` <span class="meta">${n.children.length}</span>` : ''}</div>${n.children.map(c => node(c)).join('')}</div>`;
  };
  return tree ? `<div class="bq-sum">${plural(st.concepts, 'concept')} · ${plural(st.terms, 'term')}${errors.length ? ` · <span class="bq-warn">${esc(errors.join(', '))}</span>` : ''}</div>${node(tree)}` : '';
}
/** Draws the outline of the query now in the box, when the inspector holds it. */
function drawOutline() {
  if (!outlineHost?.isConnected) return;
  const text = currentQuery().text;
  outlineHost.innerHTML = text.trim() ? outlineHtml(text) : emptyState({ title: 'Type a query to see its structure', size: 'inline' });
}
/** The inspector's Details for the Literature page: the structure of the query in the box (a database session's own syntax has none). */
export function inspect() {
  syncState();
  if (mode !== 'search' || siteSource(sourceId)) return [];
  return [{ title: 'Query outline', html: '<div class="bq" id="bq-outline"></div>', wire: host => { outlineHost = host.querySelector('#bq-outline'); drawOutline(); } }];
}

let knownV = -1, knownIdx = null;
/** libraryIndex(get().papers), kept while the project's version stands; `refresh()` reads again after an edit. */
function knownIndex() {
  const read = () => { if (knownV !== getVersion() || !knownIdx) { knownIdx = libraryIndex(get().papers); knownV = getVersion(); } return knownIdx; };
  return { find: r => read().find(r), add: p => read().add(p), refresh: read };
}

/**
 * The title bar (lib/topbar.mjs): the page's name, its five tools as the bar's view switch (a dropdown when it does not fit), and the open
 * tool's state as the status (Citation chasing: OpenAlex credits left; Seed records: the seeds loaded) and its page commands (Living review).
 */
export function pageSpec({ tool, status = '', overflow = [] }, { show = () => {} } = {}) {
  return { title: 'Literature', ...(status ? { status: { text: status, ch: 24 } } : {}),
    view: { id: 'lit-tool', label: 'Literature tool', attr: 'data-lit-tool', value: tool, items: TOOL_LABELS, run: show }, actions: [], overflow };
}
export function page(rerender) {
  syncState();
  const living = mode === 'living' ? livingPage(rerender) : {};
  return pageSpec({ tool: mode, status: mode === 'chase' ? chaseStatus() : mode === 'seeds' ? seedsStatus() : living.status || '', overflow: living.overflow || [] },
    { show: id => { select(id); rerender(); } });
}

export function render(el, ctx) {
  syncState();
  el.innerHTML = '<div id="lit-content"></div>';
  renderContent(el.querySelector('#lit-content'), ctx);
}

function renderContent(el, ctx) {
  syncState();
  if (mode !== 'search') {
    const tool = { chase: renderChase, seeds: renderSeeds, strategy: renderStrategy, living: renderLiving }[mode];
    el.innerHTML = '<div class="lit-tool-host"></div>';
    tool(el.querySelector('.lit-tool-host'), ctx);
    return;
  }
  const runs = get().searches || [];
  // The library's identity index, rebuilt only when the project changed: at
  // 20,000 records it is 60,000 map entries, too many for every click.
  const known = knownIndex();
  const targetCollection = () => coll.collections().find(c => c.id === destination);
  const canSelect = r => canAddResult(r, known, targetCollection());
  const collectionOptions = (nodes, path = '') => nodes.map(c => {
    const label = path ? `${path} / ${c.name}` : c.name;
    return `<option value="${esc(c.id)}"${destination === c.id ? ' selected' : ''}>${esc(label)}</option>${collectionOptions(c.children, label)}`;
  }).join('');
  // Web of Science and Scopus run in the user's own session (views/site-search.mjs).
  const site = siteSource(sourceId);
  const src = site || sourceOf(sourceId);
  let sitePanel = null;

  const fieldTags = site ? site.tags : TAGS;
  const improvements = site ? [] : aid.actionsFor('search', { view: 'search', focus: focus() });
  // where Add selected and Add all put the records: worded as a destination (To Library), never as the act itself, which is the button beside it
  const destinations = [['', 'To Library'], ...(function flat(nodes, path = '') { return nodes.flatMap(c => { const label = path ? `${path} / ${c.name}` : c.name; return [[c.id, `To ${label}`], ...flat(c.children, label)]; }); })(coll.tree())];
  const prevButton = () => el.querySelector('#more [data-dir="-1"]'), nextButton = () => el.querySelector('#more [data-dir="1"]');
  const pageBar = () => pagerBar({ id: 'results-pages', label: 'Result pages', text: ' ', steps: [{ key: 'prev', attrs: { 'data-dir': -1 } }, { key: 'next', attrs: { 'data-dir': 1 } }] });

  el.innerHTML = `<div class="panel search-workbench">
      <div class="search-source-row">
        <label class="search-database" for="search-source">Database<button id="search-source" type="button" aria-label="Search database: ${esc(src.name)}" aria-haspopup="menu" aria-expanded="false">${sourceImage(src.id)}<span>${esc(src.name)}</span>${icon('chevron-down', { size: 14 })}</button></label></div>
      <div class="search-body">
        <div class="query">
          <textarea id="q" rows="2" aria-label="Search query" placeholder="${esc(src.hint)}"
            spellcheck="false">${esc(draft ?? lastQuery)}</textarea>
          ${uiBar({ kind: 'tools', label: 'Query tools', id: 'query-tools', cls: 'query-foot',
            filters: src.id === 'pubmed' || site ? [{ type: 'select', id: 'field-insert', label: 'Insert field tag', value: '', options: [['', 'Insert field'], ...fieldTags.map(([l, t]) => [t, l])] }] : [],
            actions: [uiGroup({ id: 'query-ops', label: 'Boolean operators', display: 'text', role: 'quiet', items: ['AND', 'OR', 'NOT'].map(o => ({ id: `op-${o.toLowerCase()}`, label: o, attrs: { 'data-op': ` ${o} ` } })) }),
              { id: 'draft', label: 'Draft', icon: 'draft-query', role: 'quiet', disabled: !configured(modelFor('query')) },
              { id: 'run', label: site ? `${inDesktop() ? 'Run in' : 'Open'} ${site.name}` : 'Search', icon: site ? (inDesktop() ? 'download' : 'open') : 'search', role: 'primary' }],
            overflow: site ? [] : [{ id: 'structure', label: 'Query outline' }, ...(improvements.length ? ['-'] : []), ...improvements.map(a => ({ id: `improve-${a.id}`, label: a.label, disabled: !aid.hasModel(a.task), attrs: { 'data-improve': a.id } })), { id: 'improve-model', label: 'Model settings' }] })}
        </div>
        ${uiStatusLine({ id: 'query-status', label: 'Search status', parts: [{ id: 'search-status', text: '', ch: 24, drop: 1, attrs: { 'aria-live': 'polite' } }, { id: 'budget', text: '', ch: 24, drop: 2, hidden: src.id !== 'openalex' }] })}
      </div>
      ${site ? '<div id="site-panel"></div>' : ''}
    </div>

    <div class="panel" id="resultsPanel" hidden>
      ${uiBar({ kind: 'head', label: 'Results', id: 'results-head', lead: { title: 'Results', level: 'h2' }, message: { id: 'rmeta', text: '' },
        filters: [{ type: 'select', id: 'add-destination', label: 'Add papers to', options: destinations, value: destination }],
        actions: [{ id: 'add-all', label: 'Add all', icon: 'library-add', disabled: true }, { id: 'add', label: 'Add selected', icon: 'plus', role: 'primary', disabled: true }],
        overflow: [...(coll.collections().some(c => /known/i.test(c.name)) ? [{ id: 'known', label: 'Check known papers' }] : []), { id: 'all', label: 'Select page' }, { id: 'none', label: 'Clear selection' }] })}
      <div class="panel-body"><div id="results"></div></div>
      <div class="ov-pager" id="more" hidden>${pageBar()}</div>
    </div>

    <div id="search-log">${logMarkup(runs)}</div>`;

  const q = el.querySelector('#q');
  autoGrow(q);
  // The query's structure is drawn in the inspector (this view's inspect()), from the text as it is typed.
  let treeT = null;
  q.addEventListener('input', () => { draft = q.value; clearTimeout(treeT); treeT = setTimeout(drawOutline, 150); });
  const status = el.querySelector('#search-status');
  // After a redraw (adding records repaints the page) the line to write to is the new one.
  const say = text => { const line = status.isConnected ? status : document.querySelector('#search-status'); if (line) { line.textContent = text; line.title = text; } };
  el.querySelectorAll('[data-improve]').forEach(b => b.onclick = () => ctx.runModelAction(b.dataset.improve, { view: 'search', focus: focus() }));
  el.querySelector('#improve-model')?.addEventListener('click', () => ctx.openModelSettings());
  el.querySelector('#draft').onclick = async () => {
    const state = get();
    const b = el.querySelector('#draft'); b.disabled = true;
    say('Drafting');
    try {
      let qtext = await draftQuery(get().protocol, modelFor('query'));
      if (get() !== state) return;
      if (site) qtext = translateInto(site.id, qtext, site.target);
      q.value = qtext; q.dispatchEvent(new Event('input')); say('');
    } catch (err) { if (get() === state) say(err.message.slice(0, 80)); }
    b.disabled = false;
  };
  if (!site) el.querySelector('#structure').onclick = () => { try { ctx.openDetails(); } catch { /* a page with no inspector */ } drawOutline(); };
  drawOutline();

  const insert = text => {
    const a = q.selectionStart ?? q.value.length, b = q.selectionEnd ?? a;
    q.value = q.value.slice(0, a) + text + q.value.slice(b);
    q.focus(); q.selectionStart = q.selectionEnd = a + text.length;
    q.dispatchEvent(new Event('input'));
  };
  const fieldInsert = el.querySelector('#field-insert');
  if (fieldInsert) fieldInsert.onchange = () => {
    if (fieldInsert.value) insert(fieldInsert.value);
    if (fieldInsert.value.endsWith('()')) q.selectionStart = q.selectionEnd = q.selectionStart - 1;
    fieldInsert.value = '';
  };
  el.querySelectorAll('[data-op]').forEach(b => b.onclick = () => insert(b.dataset.op));

  let loading = false;
  async function search(query, offset = 0) {
    if (!query || loading) return;
    loading = true;
    const state = get(), source = sourceId, serial = ++searchSerial;
    const src2 = sourceOf(source);
    const btn = el.querySelector('#run'); btn.disabled = true;
    const more = nextButton();
    more.disabled = true; prevButton().disabled = true;
    // The control that was pressed carries the motion; the results area shows
    // the shape of what is coming rather than going blank.
    (offset ? more : btn)?.classList.add('busy');
    say(`${offset ? 'Loading more' : 'Searching'} ${src2.name}`);
    if (!offset) {
      results = []; pageIndex = 0; chosen = new Set();
      el.querySelector('#resultsPanel').hidden = false;
      el.querySelector('#results').innerHTML = skeleton(6);
      el.querySelector('#more').hidden = true;
      el.querySelector('#rmeta').textContent = '';
    }
    const at = new Date().toISOString();
    try {
      const r = await runSearch(source, query,
        { offset, limit: PAGE, settings: settings() });
      if (get() !== state || sourceId !== source || serial !== searchSerial) return;
      total = r.total;
      const page = r.records;
      results = offset ? [...results, ...page] : page;
      activeQuery = query;
      lastQuery = query;
      if (offset && page.length) pageIndex = Math.floor(offset / PAGE);
      loading = false;
      // A source can report more than it will hand over; "complete" means the
      // review actually holds every record, not that the search finished.
      const complete = results.length >= total;
      const entry = { at, query, total, retrieved: results.length,
                      source: r.source, kind: r.kind,
                      status: complete ? 'complete' : 'partial' };
      update(st => {
        const log = [...(st.searches || [])];
        if (offset && runIndex !== null && log[runIndex])
          log[runIndex] = { ...log[runIndex], ...entry, at: log[runIndex].at };
        else { log.push(entry); runIndex = log.length - 1; }
        st.searches = log; return st;
      });
      say(!results.length && total === 0 ? 'No results'
        : complete ? `All ${num(total)} retrieved`
        : `${num(results.length)} of ${num(total)} retrieved`);
      paint(); refreshLog(); ctx.refreshCounts();
    } catch (err) {
      if (get() !== state || sourceId !== source || serial !== searchSerial) return;
      loading = false; paint();
      say(`${src2.name}: ${err.message}`);
      if (!results.length) el.querySelector('#resultsPanel').hidden = true;
      if (!offset) update(st => { st.searches = [...(st.searches || []),
        { at, query, total: 0, retrieved: 0, source: src2.name, kind: src2.kind,
          status: 'failed' }];
        runIndex = st.searches.length - 1; return st; });
      refreshLog();
    }
    btn.disabled = false;
    btn.classList.remove('busy'); more?.classList.remove('busy');
  }

  function paint() {
    el.querySelector('#resultsPanel').hidden = !results.length;
    if (!results.length) return;
    known.refresh();
    chosen = new Set(results.filter(r => chosen.has(r.key) && canSelect(r)).map(r => r.key));
    el.querySelector('#rmeta').textContent = `${chosen.size} of ${results.length} selected`;
    el.querySelector('#more').hidden = false;
    prevButton().disabled = loading || pageIndex === 0;
    nextButton().disabled = loading || (pageIndex + 1) * PAGE >= total;
    el.querySelector('#more .ui-bar-message').textContent = `${num(pageIndex * PAGE + 1)}–${num(Math.min((pageIndex + 1) * PAGE, results.length))} of ${num(total)}`;
    el.querySelector('#add').disabled = !chosen.size;
    el.querySelector('#add-all').disabled = !total || !!running().find(j => j.kind === 'search' && j.allOf);
    el.querySelector('#results').innerHTML = tableRegion({ label: 'Search results', html: `<table>
      <thead><tr><th class="col-pick"></th><th class="grow">Title</th><th class="res-wide">Authors</th>
        <th class="res-wide">Journal</th><th class="res-wide">Year</th><th class="res-wide">Identifier</th></tr></thead>
      <tbody>${results.slice(pageIndex * PAGE, (pageIndex + 1) * PAGE).map(r => {
        const have = known.find(r);
        const savedCollections = have ? coll.collectionsOf(have.id).map(c => c.name).join(', ') : '';
        return `<tr><td><input type="checkbox" data-pick="${esc(r.key)}"
            aria-label="Select ${esc(r.title)}" ${chosen.has(r.key) ? 'checked' : ''}${canSelect(r) ? '' : ' disabled'}></td>
          <td class="grow res-title">${esc(r.title)}${have ? `<span class="result-saved" title="${esc(savedCollections ? `Collections: ${savedCollections}` : 'Saved in your library')}">${icon('check')}In library${savedCollections ? ` · ${esc(savedCollections)}` : ''}</span>` : ''}<span class="meta res-sub">${esc([authorLine(r.authors), journalShort(r), r.year].filter(Boolean).join(' · '))}</span></td>
          <td class="res-authors res-wide" title="${esc(authorList(r.authors).join('; '))}">${esc(authorLine(r.authors))}</td>
          <td class="res-journal res-wide" title="${esc(r.journal || '')}">${esc(journalShort(r))}</td><td class="res-wide">${esc(r.year ?? '')}</td>
          <td class="meta res-wide">${esc(identifier(r))}</td></tr>`;
      }).join('')}</tbody></table>` });
    // below NARROW_RESULTS px the table keeps the title and its quiet line (lib/narrow.mjs measures; research-views.css)
    watchNarrow(el.querySelector('#results'), NARROW_RESULTS);
    el.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => {
      cb.checked ? chosen.add(cb.dataset.pick) : chosen.delete(cb.dataset.pick);
      el.querySelector('#add').disabled = !chosen.size;
      el.querySelector('#rmeta').textContent = `${chosen.size} of ${results.length} selected`;
    });
  }
  // Plan B4: a known-paper check — a test, not proof of exhaustive retrieval.
  {
    el.querySelector('#known')?.addEventListener('click', () => {
      const c = coll.collections().find(x => /known/i.test(x.name));
      if (!c) { el.querySelector('#rmeta').textContent = 'No collection named “Known papers”'; return; }
      const knownIds = new Set(get().papers.filter(p => coll.collectionsOf(p.id).some(y => y.id === c.id)).map(p => p.key));
      const got = [...knownIds].filter(k => results.some(r => r.key === k)).length;
      el.querySelector('#rmeta').textContent = `Known papers: ${got} of ${knownIds.size} retrieved${results.length < total ? ` (of ${results.length} loaded)` : ''}`;
    });
  }

  const changeSource = id => {
    if (id === sourceId) return;
    sourceCache.set(sourceId, { results, selected: chosen, total, runIndex, activeQuery, pageIndex, draft: q.value });
    const leaving = siteSource(sourceId), leftText = q.value;
    sourceId = id; searchSerial++;
    const saved = sourceCache.get(sourceId);
    results = saved?.results || []; chosen = saved?.selected || new Set(); total = saved?.total || 0;
    runIndex = saved?.runIndex ?? null; activeQuery = saved?.activeQuery || ''; pageIndex = saved?.pageIndex || 0;
    draft = saved?.draft ?? q.value;
    // Each database gets the query in its own syntax: a strategy is translated
    // into Web of Science or Scopus, and leaving them restores the strategy.
    const entering = siteSource(sourceId);
    if (entering) draft = siteDraft(entering, { fromSite: leaving, text: leftText, saved: saved?.draft ?? null });
    else if (leaving) draft = saved?.draft ?? siteStrategy(leaving.id) ?? '';
    ctx.rerender();
    document.getElementById('search-source')?.focus();
  };
  const sourceButton = el.querySelector('#search-source');
  sourceButton.onclick = () => showMenu(sourceButton, [...SOURCES, ...(SITES.length ? ['-', ...SITES] : [])].map(o => o === '-' ? '-'
    : { label: o.name, imageSrc: `./assets/sources/${SOURCE_ICONS[o.id]}`, checked: o.id === sourceId, run: () => changeSource(o.id) }), { className: 'search-source-menu', minWidth: 240 });
  el.querySelector('#run').onclick = () => {
    if (site) { sitePanel?.run(); return; }
    chosen = new Set(); runIndex = null; search(q.value.trim());
  };
  // Enter searches; Shift+Enter adds a line, since a query can be multi-line.
  q.onkeydown = e => {
    // A database session run exports every record, so it starts from its button only.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || site) return;
    e.preventDefault();
    el.querySelector('#run').click();
  };
  prevButton().onclick = () => { if (!loading && pageIndex > 0) { pageIndex--; paint(); } };
  nextButton().onclick = () => {
    if (loading) return;
    if ((pageIndex + 1) * PAGE < results.length) { pageIndex++; paint(); }
    else search(activeQuery, results.length);
  };
  el.querySelector('#add-destination').onchange = e => { destination = e.target.value; paint(); };
  el.querySelector('#all').onclick = () => {
    known.refresh();
    results.slice(pageIndex * PAGE, (pageIndex + 1) * PAGE).filter(canSelect).forEach(r => chosen.add(r.key)); paint();
  };
  el.querySelector('#none').onclick = () => { chosen = new Set(); paint(); };
  el.querySelector('#add').onclick = () => {
    const picked = results.filter(r => chosen.has(r.key)).map(toLibrary);
    let added = 0;
    update(st => { added = addSearchRecords(st, picked, destination); return st; });
    chosen = new Set();
    ctx.rerender(); ctx.refreshCounts();
    say(`Added ${num(added)} to ${coll.collections().find(c => c.id === destination)?.name || 'Library'}`);
  };
  // Plan B6: a protocol search brings in every record it found, as a job that
  // can be stopped (lib/search-run.mjs). The run's log entry then says how many
  // the review holds, how many were already in the library, and whether the
  // download finished; a stopped, capped or paused download stays marked partial.
  const startAll = opts => addAll({ ...opts, settings: settings() })
    .then(msg => { if (el.isConnected && typeof msg === 'string') say(msg); })
    .catch(err => { if (el.isConnected) say(err.name === 'AllowanceError' ? err.message : `${sourceOf(opts.sourceId).name}: ${err.message}`); })
    .finally(() => { if (el.isConnected) { paint(); refreshLog(); ctx.refreshCounts(); } });
  el.querySelector('#add-all').onclick = async () => {
    const query = activeQuery, source = sourceId, src2 = sourceOf(source), dest = destination, entry = runIndex, n = Math.min(total, 10000);
    if (!query || !n) return;
    const ok = await confirmAsk(`Add all ${num(n)} records from ${src2.name}?`,
      { detail: `${total > 10000 ? `The first 10,000 of ${num(total)} · ` : ''}${coll.collections().find(c => c.id === dest)?.name || 'Library'}`, confirm: 'Add all' });
    if (!ok) return;
    el.querySelector('#add-all').disabled = true;
    startAll({ query, sourceId: source, total, dest, entry });
  };
  // Loading a past query does not run it; each search is an explicit record.
  const rerun = i => {
    const run = (get().searches || [])[i];
    if (!run) return;
    const siteRun = siteSource(run.source);
    if (siteRun) {
      // The logged query is the one sent to the site; the strategy it came from goes back in the box.
      setSiteQuery(siteRun.id, run.query, run.strategy || '');
      sourceId = siteRun.id; searchSerial++; results = []; chosen = new Set();
      total = 0; activeQuery = ''; runIndex = null; lastQuery = run.query; draft = run.query;
      ctx.rerender();
      return;
    }
    const back = SOURCES.find(o => o.name === run.source);
    if (back && back.id !== sourceId) {
      sourceId = back.id; searchSerial++; results = []; chosen = new Set();
      total = 0; activeQuery = ''; runIndex = null; lastQuery = run.query;
      ctx.rerender();
    }
    const box = document.querySelector('#q');
    box.value = run.query;
    box.dispatchEvent(new Event('input'));
    box.focus();
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Plan B7: an exploratory run stays in the log but leaves PRISMA's records identified.
  const explore = i => {
    update(st => { const r = st.searches?.[i]; if (r) { if (r.exploratory) delete r.exploratory; else r.exploratory = true; } return st; });
    refreshLog(); ctx.refreshCounts();
  };
  const repeatWeekly = i => {
    const r = (get().searches || [])[i];
    if (!r) return;
    const src2 = SOURCES.find(o => o.name === (r.source || 'PubMed')) || SOURCES[0];
    addSchedule({ query: r.query, sourceId: src2.id, sourceName: src2.name, interval: 'weekly' });
    refreshLog();
  };
  /** What a run's More holds: the rest of what the row would otherwise carry as links. */
  const logMenu = (i, row) => {
    const r = (get().searches || [])[i]; if (!r) return [];
    const imported = r.imported || r.citationSearch || r.related;
    const plain = (r.imported && !hasQuerySyntax(r.query)) || r.citationSearch || r.related;     // a citation or related-article run has no query to draw
    const qd = row.querySelector('.qd'), full = qd?.querySelector(':scope > .qd-full'), short = qd?.querySelector(':scope > .qd-short'), text = row.querySelector('.q-text');
    const sched = schedules().find(x => x.query === r.query && x.sourceName === (r.source || 'PubMed'));
    const items = [];
    if (!plain && full && short && qd && !qd.hidden) items.push({ label: full.hidden ? 'All terms' : 'Fewer terms', run: () => { const all = full.hidden; short.hidden = all; full.hidden = !all; } });
    if (!plain) items.push({ label: text.hidden ? 'Query text' : 'Hide query text', run: () => { const on = text.hidden; text.hidden = !on; if (qd) qd.hidden = on; } });
    if (!imported) items.push({ label: 'Search again', run: () => rerun(i) });
    if (r.status !== 'failed') items.push({ label: r.exploratory ? 'Count in PRISMA' : 'Mark exploratory', run: () => explore(i) });
    if (!imported && !sched && !siteSource(r.source)) items.push({ label: 'Repeat weekly', run: () => repeatWeekly(i) });
    return items;
  };
  function wireLog() {
    const outside = el.querySelector('#log-outside'); if (outside) outside.onclick = () => logOutside(ctx);
    const list = el.querySelector('#search-log-list'); if (!list) return;
    wireQueryDiagrams(list);
    // A row opens, in place, the records its search brought in.
    const closeAll = () => list.querySelectorAll('.log-detail').forEach(d => { d.previousElementSibling?.setAttribute('aria-expanded', 'false'); d.remove(); });
    const toggle = row => {
      const open = row.getAttribute('aria-expanded') === 'true';
      closeAll();
      if (open) return;
      const i = Number(row.dataset.log), r = (get().searches || [])[i]; if (!r) return;
      row.setAttribute('aria-expanded', 'true'); resetPagedList(`search-log-records-${i}`);
      row.insertAdjacentHTML('afterend', logDetail(r, i));
      const d = row.nextElementSibling;
      wireDetail(d, r, i);
    };
    // The records of one run, a page at a time: a page turn redraws the detail in place.
    const wireDetail = (d, r, i) => {
      const key = `search-log-records-${i}`, recs = runRecords(r);
      const body = d.querySelector('.log-records');
      if (body) wireDataPager(body, key, { total: recs.length, size: PAGE, onChange: () => {
        d.insertAdjacentHTML('afterend', logDetail(r, i)); const next = d.nextElementSibling; d.remove(); wireDetail(next, r, i);
        next.querySelector('.ov-pager [data-dir]:not(:disabled)')?.focus();
      } });
      d.querySelectorAll('[data-log-paper]').forEach(rec => { const go = () => { focusPaper(rec.dataset.logPaper); ctx.go('library'); }; rec.onclick = go; rec.onkeydown = e => { if (e.key === 'Enter') go(); }; });
      d.querySelector('[data-log-library]')?.addEventListener('click', () => {
        showSubset(recs.map(p => p.id), `${plural(recs.length, 'record')} · ${r.source || 'PubMed'} search`); ctx.go('library');
      });
    };
    list.querySelectorAll('.ui-row[data-log]').forEach(row => {
      row.onclick = e => { if (e.target.closest('button, a, input, select, summary, details, code')) return; toggle(row); };
      row.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(row); } };
    });
    list.querySelectorAll('[data-log-more]').forEach(b => b.onclick = () => { const items = logMenu(Number(b.dataset.logMore), b.closest('.ui-row')); if (items.length) showMenu(b, items, { align: 'end' }); });
    list.querySelectorAll('[data-resume]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.resume), r = (get().searches || [])[i];
      if (!r?.paused) return;
      b.disabled = true;
      startAll({ query: r.query, sourceId: r.paused.sourceId || SOURCES.find(x => x.name === r.source)?.id, total: Number(r.total) || 0,
        dest: r.paused.dest || '', entry: i, start: Number(r.paused.offset) || 0 });
    });
    const runs = get().searches || [];
    if (runs.length > LOG_PAGE) wireDataPager(list, 'search-log', { total: runs.length, size: LOG_PAGE, onChange: refreshLog });
  }
  function refreshLog() {
    el.querySelector('#search-log').innerHTML = logMarkup(get().searches || []);
    wireLog();
  }
  wireLog();
  // OpenAlex's daily allowance, from the headers of its last answer; a request that costs no credits fills it before the first search.
  const budgetEl = el.querySelector('#budget');
  if (budgetEl) {
    const at = t => when(t);
    const draw = b => {
      if (!b || (b.remaining == null && !b.closed)) { budgetEl.textContent = ''; return; }
      budgetEl.textContent = b.closed
        ? `Used up until ${at(b.resetAt || Date.now())}`
        : `${num(b.searches)} searches left`;
      budgetEl.title = b.closed && !settings().openalexKey ? 'Allowance used up. Add a key in Settings, Sources, or wait.' : '';
    };
    const refresh = () => openalexBudget({ settings: settings() }).then(b => { if (budgetEl.isConnected) draw(b); }).catch(() => {});
    const off = onBudget(() => { if (!el.isConnected) off(); else refresh(); });
    refresh();
  }
  sitePanel = site ? renderSitePanel(el.querySelector('#site-panel'), { site, box: q, ctx,
    onLogged: () => { refreshLog(); ctx.refreshCounts(); } }) : null;

  paint();
}

/** Placeholder rows in the shape of the result table, while the search runs. */
function skeleton(n) {
  return `<table class="skel"><thead><tr><th class="col-pick"></th><th class="grow">Title</th><th>Authors</th>
    <th>Journal</th><th>Year</th><th>Identifier</th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr>
    <td><i class="sk sk-check"></i></td>
    <td class="grow"><i class="sk sk-title sk-t${i % 3}"></i></td>
    <td><i class="sk sk-authors"></i></td><td><i class="sk sk-journal"></i></td>
    <td><i class="sk sk-year"></i></td><td><i class="sk sk-id"></i></td></tr>`).join('')}</tbody></table>`;
}

/** Retrieved-versus-found, stated rather than labelled. A partial download is
 *  the thing a reader must be able to see (plan B6). The text holds to 24 characters: the cell is that wide. */
function statusCell(r) {
  const mark = (name, text, partial = false) => `<span class="status${partial ? ' partial' : ''}">${icon(name)}${esc(text)}</span>`;
  if (r.status === 'failed') return `<span class="status failed">${icon('warn')}Failed</span>`;
  if (r.paused) return mark('dot', `${num(r.retrieved) || '—'} of ${num(r.total) || '—'} · paused`, true);
  if (r.citationSearch || r.related) return r.exploratory ? mark('dot', `Not in PRISMA · ${num(r.retrieved ?? 0)}`) : mark(r.status === 'partial' ? 'dot' : 'check', `${num(r.retrieved ?? 0)} found · ${num(r.new ?? 0)} new`, r.status === 'partial');
  if (r.exploratory) return mark('dot', `Not in PRISMA · ${num(r.retrieved ?? r.total ?? 0)}`);
  if (r.status === 'partial') return mark('dot', `${num(r.retrieved) || '—'} of ${num(r.total) || '—'} · partial`, true);
  const n = r.total ?? r.retrieved;
  return n == null ? '<span class="meta">—</span>' : mark('check', `${num(n)} records`);
}

/**
 * A logged query as its structure: each AND block on its own line, listing
 * the terms it ORs together; the exact text is folded underneath (the row's
 * More shows it), and a search run here can be run again.
 */
function queryCell(r) {
  // A log entry for an imported file names the file; it is not a query to draw as terms joined by AND.
  // A run imported with its query text (a saved query file) is a real query and is drawn.
  const isQuery = hasQuerySyntax(r.query);
  const plain = (r.imported && !isQuery) || r.citationSearch || r.related;   // a citation or related-article run has no query to draw
  const drawn = plain ? `<span class="q-import" title="${esc(r.query || '')}">${esc(r.query || '')}</span>` : queryDiagram(r.query, { controls: false, source: r.sourceId || r.source });
  return `<span class="qd-host">${drawn}<code class="q-text" hidden>${esc(r.query)}</code></span>`;
}

/** What a record is called in its own source, for the identifier column. */
function identifier(r) {
  if (r.pmid) return `PMID ${r.pmid}`;
  if (r.doi) return r.doi;
  return r.key.replace(/^[a-z]+-/, '');
}

// A search result becomes a library record (lib/search-library.mjs libraryRecord).
const toLibrary = libraryRecord;

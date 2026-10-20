import { REGISTRY } from './registry.mjs';
import { formatBytes } from '../lib/cache-budget.mjs';
import { effortLabel } from '../lib/model-effort.mjs';
import { teamsBody, wireTeams, showTeam as startTeam } from './settings-teams.mjs';
import { render as renderMcp } from './mcp.mjs';
// Settings: the engine, the services it talks to, and the project file.
import { saveFile } from '../lib/save.mjs';
import { inDesktop, inHostedTab, testPaperMirrorNative, unpaywallEmailNative, setUnpaywallEmailNative, openLinksInApp, setOpenLinksInApp, browserStateNative, browserClearDataNative, chatGptCancelSigninNative } from '../lib/native.mjs';
import { backupOpenProject, backupReport } from '../lib/project-backup.mjs';
import { restoreFlow } from './dashboard-flow.mjs';
import { get, update, listRecoveries, readRecovery, restoreRecovery, exportableWithFigures, replaceProject, figureCleanup, getVersion, backupState, retryBackup } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { engine, installed, releaseR, resourcePolicy, setResourcePolicy, IDLE_MINUTES } from '../lib/r.mjs';
import { icon } from '../lib/icons.mjs';
import { problemOf } from '../lib/provider-error.mjs';
import { PROVIDERS, configured, listModelsDetailed, cachedModels } from '../lib/ai.mjs';
import { testConnection } from '../lib/ai-connection.mjs';
import { connectWizard } from './settings-connect.mjs';
import { scopeBody, wireScope } from './settings-egress.mjs';
import { sentBody, wireSent } from './settings-sent.mjs';
import { markTested, connectionName } from '../lib/connect-steps.mjs';
import { confirmAsk, formDialog, formValues } from '../lib/dialog.mjs';
import { preference, set as setTheme, THEMES } from '../lib/theme.mjs';
import { schedules, INTERVALS, remove as removeSchedule, toggle as toggleSchedule, setInterval_ as setScheduleInterval, runSchedule, nextRun } from '../lib/schedule.mjs';
import { jobs } from '../lib/jobs.mjs';
import { STYLES } from '../lib/cite.mjs';
import { chooseJournal, wireJournalButton } from '../lib/journal-picker.mjs';
import { journalContext, changeTarget, styleLabel } from '../lib/journal-context.mjs';
import { chatGptAccount, chatGptCatalog, signInChatGpt, signOutChatGpt, openChatGptUsage } from '../lib/chatgpt.mjs';
import { chooseModel } from '../lib/model-picker.mjs';
import { ago, when, plural, num } from '../lib/dates.mjs';
import { roots, addFolder, forgetFolder } from '../lib/folders.mjs';
import { RESEARCH_TYPES, projectMode, projectName, patientDataEnabled, researchType, targetJournal, otherJournals, setJournals } from '../lib/workflow.mjs';
import { aiUsage } from '../lib/ai-usage.mjs';
import { pdfSource, MAX_PDF_SOURCES } from '../lib/pdf-sources.mjs';
import { freshDays } from '../lib/integrity.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiSettingsRow, uiSwap, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { updateText, updateState, onUpdateState, checkForUpdate, restartToUpdate } from '../lib/app-update.mjs';
let stopUpdate = null;   // the About section's listener on the updater
import { dismissedCount, clearDismissed } from '../lib/task-suggest.mjs';
import { formField, tableRegion } from '../lib/ui-components.mjs';
import { SHORTCUTS } from '../lib/shortcuts.mjs';
import { appIdentity, versionLabel, renderNotices } from '../lib/about.mjs';
import { canOpenFolders } from '../lib/fsys.mjs';
import { projectsBody, wireProjects } from './projects-panel.mjs';
import { storageBody, wireStorage } from './settings-storage.mjs';
import { MEASURES } from '../lib/effect-measures.mjs';
import { openalexKeyChanged } from '../lib/sources.mjs';
import { budgetNumber, budgetProblem } from '../lib/chat-budget.mjs';
import { runBudgetOf, runBudgetProblem } from '../lib/extraction-normalise.mjs';
import { settings, own, saveOwn, putOwn, chatBudgetOf, TASKS, profiles, connectionBase, defaultProfileKey, changeProfileProvider, setProfiles, openRouterSource, askOpenRouterModel, setTaskModel, makeProfileAppWide, pinScalar, saveApp, setTaskRoute, modelFor } from '../lib/model-settings.mjs';
export { settings, TASKS, retiredProfiles, profiles, defaultProfileKey, changeProfileProvider, setProfiles, ensureJevProfile, openRouterSource, addOpenRouterModel, askOpenRouterModel, setTaskModel, makeProfileAppWide, pinScalar, saveApp, profileOptions, cheapestProfile, setTaskRoute, modelFor, secondScreenModel } from '../lib/model-settings.mjs';   // the model profiles live in lib/model-settings.mjs so the shell need not load this page
import { layers, overridesOf, withoutOverride, appValues, appSettingsStatus, appSettingsWhere, maskKey } from '../lib/app-settings.mjs';
import { quickModelItems } from '../lib/model-controls.mjs';

export const meta = { title: 'Settings', icon: 'settings' };
// No count beside Settings in the sidebar: it read as an unread badge. Recovery copies are a row under General, Files and recovery.
export const count = (...a) => REGISTRY.settings.count(...a);


const REVOKE_NOTE = 'Signed out here. Remote revocation was not confirmed: disconnect Lykos in ChatGPT settings.';
const MIRRORS = [['scihub', 'Sci-Hub mirror', 'https://sci-hub.st'], ['scidb', 'SciDB mirror', 'https://annas-archive.se/scidb/']];
let section = 'appearance';   // which category is open
/** Opens Settings at one section next time it draws (e.g. 'sources'). */
export function openSection(id) { section = id; }
// Worked out once per project version (see figureRow in render).
let figurePlan = { version: -1, plan: null }, recoveryCache = { version: -1, list: null }, recoveryPage = 1;
const RECOVERY_PAGE = 8;   // the store keeps up to 20 copies: a page of them, not all at once
let editing = '';             // the model profile open for editing
export const navigationState = () => ({section});
export function restoreNavigation(state) {
  if (['appearance','you','mcp','engine','sources','folders','previews','model','usage','sent','screening','analysis','scheduled','workflows','project','storage'].includes(state.section)) section=state.section;
}
export function showProject() { section = 'project'; }
export function showMcp() { section = 'mcp'; }
/** Settings > Teams, with `id` open for editing ('new' starts one; nothing leaves the list). */
export function showTeams(id) { section = 'teams'; if (id) startTeam(id); }
export function showKeyboard() { section = 'keyboard'; }
export function showAbout() { section = 'about'; }
/** Opens Settings at the project list (the project menu's Manage projects). */
export function showProjects() { section = 'projects'; }
export function showModels() { section = 'model'; }

// The title bar's declaration (TOPBAR R2): the open section is the page's title and the sections are its title menu. It runs before render(), so the
// names, groups and availability are kept here, in the order render() lists them (General first, then the groups in GROUP_ORDER); a Node test
// (settings-sections.test.mjs) fails when render()'s SECTIONS and this table differ.
export const GROUP_ORDER = ['Project', 'Review', 'Workspace', 'AI', 'Advanced'];
export const SECTION_HEADS = [
  ['project', 'Project', 'General'], ['appearance', 'Workspace', 'Appearance'], ['you', 'Workspace', 'You'], ['mcp', 'Advanced', 'MCP access', () => !inHostedTab()],
  ['engine', 'Advanced', 'R engine'], ['sources', 'Review', 'Sources'], ['folders', 'Workspace', 'Folders', () => canOpenFolders()], ['projects', 'Workspace', 'Projects'], ['previews', 'Workspace', 'Paper previews', () => !inHostedTab()],
  ['browser', 'Workspace', 'Browser', () => inDesktop()], ['storage', 'Workspace', 'Storage'], ['model', 'AI', 'Models'], ['usage', 'Advanced', 'AI usage'], ['sent', 'Advanced', 'Sent'],
  ['screening', 'Review', 'Screening'], ['analysis', 'Review', 'Analysis'], ['workflows', 'Advanced', 'Workflows'], ['scheduled', 'Advanced', 'Scheduled searches'],
  ['teams', 'AI', 'Teams', () => !!get().project], ['keyboard', 'Workspace', 'Keyboard'], ['about', 'Workspace', 'About'],
];
/** The sections this build and project list, as render() draws them: [{ id, group, name }]. */
export const sectionHeads = () => SECTION_HEADS.filter(([, , , shown]) => !shown || shown()).map(([id, group, name]) => ({ id, group, name }));
/** The title bar: the open section's name, a menu of the sections by group. Choosing one opens it at its top, as the category list does. */
export function page(rerender) {
  const heads = sectionHeads(), open = heads.find(x => x.id === section) || heads[0];
  const items = GROUP_ORDER.flatMap(g => { const of = heads.filter(x => x.group === g); return of.length ? [{ heading: g }, ...of.map(x => ({ label: x.name, checked: x.id === open.id,
    run: () => { section = x.id; rerender(); document.getElementById('setbody')?.scrollTo({ top: 0 }); } }))] : []; });
  return { title: open.name, titleMenu: anchor => showMenu(anchor, items, { align: 'start', minWidth: 200 }), titleNoun: 'section', actions: [] };
}

// A theme previewed as the window it produces, drawn from the theme's own
// tokens: a sidebar with nav marks, a toolbar, a panel with text and one
// accent. Three colour bars said nothing about how the app would look.
const mini = () => `<i class="m-side"><b></b><b class="m-on"></b><b></b><b></b></i>
  <i class="m-main"><i class="m-top"><u class="m-accent"></u></i>
  <i class="m-panel"><b></b><b class="m-short"></b><i class="m-line"></i><i class="m-line"></i><i class="m-line"></i></i></i>`;

const number = num;
const usageAmount = (value, missing, calls, cost = false) => {
  const formatted = cost ? `$${value.toFixed(4)}` : number(value);
  if (calls && missing === calls && value === 0) return '<span class="usage-unavailable">Unavailable</span>';
  return `${formatted}${missing ? `<small>${number(missing)} unreported</small>` : ''}`;
};

// What a call type is called, by the prompt it ran (lib/prompts.mjs); the rest read as their id.
const KIND_LABEL = { chat: 'Assistant', 'chat.summary': 'Conversation summary', 'run.summary': 'Run summary', extract: 'Extraction fill and verify', 'extract.abstract': 'Extraction from abstracts',
  'extract.page': 'Extraction from a page', 'screen.assess': 'Screening proposals', jev: 'Decision model', 'tasks.detect': 'Task notes', 'text.revise': 'Paragraph revision', 'text.draft': 'Section drafts',
  'query.draft': 'Search strategy', 'protocol.suggest': 'Protocol suggestions', 'criteria.structure': 'Criteria from prose', 'patients.parse': 'Patient rows', 'cells.fix': 'Cell rule fixes',
  'sheet.ask': 'Spreadsheet questions', 'workflow.agent': 'Workflow agent blocks', other: 'Earlier calls' };
const kindLabel = k => KIND_LABEL[k] || String(k).replace(/[.-]/g, ' ').replace(/^./, c => c.toUpperCase());

const callRow = e => uiRow({ main: { html: esc(e.model || 'Unknown model'), wrap: true, detail: [esc(kindLabel(String(e.prompt || '').split('@')[0] || e.kind)), esc(e.at ? ago(e.at) : ''),
  `${e.usage?.prompt == null ? '—' : number(e.usage.prompt)} in${e.usage?.cached ? ` (${number(e.usage.cached)} cached)` : ''} · ${e.usage?.completion == null ? '—' : number(e.usage.completion)} out · ${e.usage?.cost == null ? 'cost unavailable' : `$${e.usage.cost.toFixed(4)}`}`] } });
const jobOut = j => j.status === 'failed' ? j.error : j.status === 'running' ? (j.progress || 'running')
  : j.result && typeof j.result === 'object' ? Object.entries(j.result).map(([k, v]) => `${v} ${k}`).join(' · ') : 'done';
const jobRow = j => uiRow({ cls: `job-${j.status}`, main: { html: esc(j.label), wrap: true, detail: [esc(j.kind), esc(ago(j.startedAt)), `<span class="job-out">${esc(jobOut(j))}</span>`] } });

export function renderUsage(usage) {
  const t = usage.total;
  const missingInput = usage.models.reduce((n, m) => n + m.unknownPrompt, 0);
  const missingOutput = usage.models.reduce((n, m) => n + m.unknownCompletion, 0);
  const stat = (name, html) => uiRow({ main: { html: esc(name) }, cells: [{ col: 'value', kind: 'text', ch: 20, html }] });
  return `${uiList({ label: 'Usage in this project', cls: 'usage-stats', cols: ['value'], rows: [
    stat('Recorded calls', number(t.calls)),
    stat('Input tokens', usageAmount(t.prompt, missingInput, t.calls)),
    stat('Cached input', usageAmount(t.cached || 0, t.unknownCached ?? t.calls, t.calls)),
    stat('Output tokens', usageAmount(t.completion, missingOutput, t.calls)),
    stat('Reported cost', usageAmount(t.cost, t.unknownCost, t.calls, true))] })}
  ${usage.kinds?.length ? `<h3 class="setl-subhead">By call type</h3>
  <div class="usage-table-wrap" role="region" aria-label="Usage by call type" tabindex="0"><table class="usage-table">
    <thead><tr><th scope="col">Call type</th><th scope="col">Calls</th><th scope="col">Input tokens</th><th scope="col">Cached input</th><th scope="col">Output tokens</th><th scope="col">Reported cost</th></tr></thead>
    <tbody>${usage.kinds.map(k => `<tr><th scope="row">${esc(kindLabel(k.kind))}</th><td>${number(k.calls)}</td>
      <td>${usageAmount(k.prompt, k.unknownTokens, k.calls)}</td><td>${usageAmount(k.cached || 0, k.unknownCached ?? k.calls, k.calls)}</td>
      <td>${usageAmount(k.completion, k.unknownTokens, k.calls)}</td><td>${usageAmount(k.cost, k.unknownCost, k.calls, true)}</td></tr>`).join('')}</tbody>
  </table></div>` : ''}
  ${usage.models.length ? `<h3 class="setl-subhead">By model</h3>
  <div class="usage-table-wrap" role="region" aria-label="Usage by model" tabindex="0"><table class="usage-table">
    <thead><tr><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Reported cost</th></tr></thead>
    <tbody>${usage.models.map(m => `<tr><th scope="row">${esc(m.unattributed ? 'Earlier calls' : m.model || 'Unknown model')}<small>${esc(m.unattributed ? 'Model unavailable' : PROVIDERS[m.provider]?.label || m.provider || 'Provider unavailable')}</small></th>
      <td>${number(m.calls)}</td><td>${usageAmount(m.prompt, m.unknownPrompt, m.calls)}</td>
      <td>${usageAmount(m.completion, m.unknownCompletion, m.calls)}</td>
      <td>${usageAmount(m.cost, m.unknownCost, m.calls, true)}</td></tr>`).join('')}</tbody>
  </table></div>` : ''}
  ${usage.kinds?.length || usage.models.length ? '' : emptyState({ title: 'No model calls recorded in this project yet', size: 'inline' })}
  ${usage.total.unknownCost || usage.total.estimatedCost ? `<p class="meta" data-ui-help>${usage.total.estimatedCost
    ? `Claude costs are estimated from Anthropic’s list prices.${usage.total.unknownCost ? ' Other costs are as reported; unreported costs are unavailable.' : ''}`
    : 'Costs include only amounts reported by providers. Unreported costs are unavailable.'}</p>` : ''}
  ${usage.entries.length ? `<details class="usage-history"><summary>Recent calls</summary>${uiList({ label: 'Recent calls', rows: usage.entries.slice(0, 30).map(callRow) })}</details>` : ''}`;
}

let taskScope = 'app';   // which layer the task assignments below edit, with a project open
export function render(el, ctx, { appOnly = false } = {}) {
  const s = get();
  const cfg = settings();
  // The journal's own answer and, apart from it, what "From <journal>" would give if the style was chosen by hand.
  const jctx = journalContext(s);
  const auto = journalContext({ ...s, settings: { ...(s.settings || {}), refStyleManual: false } });
  const autoLabel = auto.source === 'preset' || auto.source === 'catalog' ? `From ${auto.journal}, ${styleLabel(auto.referenceStyle)}`
    : auto.source === 'profile' ? `From the journal profile, ${styleLabel(auto.referenceStyle)}` : `Default, ${styleLabel(auto.referenceStyle)}`;
  const status = appSettingsStatus();
  const readOnly = !!status.readOnly;
  const off = readOnly ? { disabled: true } : {};
  const where = appSettingsWhere();
  const over = appOnly ? { scalars: [], profiles: [], tasks: [], ai: false } : overridesOf(s);
  if (appOnly) taskScope = 'app';
  const appNote = () => status.error ? `<div class="note" role="alert">${esc(status.readOnly ? `App-wide settings could not be read: ${status.error}` : `App-wide settings were not saved: ${status.error}`)}</div>` : '';
  const keptIn = where === 'app' ? 'Kept on this Mac, not in projects' : where === 'browser' ? 'Kept in this browser\'s storage, not in projects' : 'Not stored in this build';
  const keptHere = where === 'app' ? 'On this Mac, not in projects' : where === 'browser' ? 'In this browser\'s storage, not in projects' : 'Not stored in this build';
  const inProject = projectMode(s);
  const pdfSources = Array.isArray(cfg.pdfSources) ? cfg.pdfSources.slice(0, MAX_PDF_SOURCES) : [];
  const usage = aiUsage(s);
  const pref = preference();

  // Two panes: the categories, and the rows of the one that is open. A single scrolling column made every setting look equally
  // important and buried the ones that matter. Searching looks across all categories at once.
  // Every row is one uiSettingsRow: the name left, its controls right as one foot bar (one action, the rest in More), on one grid, so
  // every control of a page starts at the same edge. A state a row only reports is its description (`desc`; `live: { id }` when it changes).
  let rowSerial = 0;
  const srow = (name, { desc = '', line = false, live, find = '', readout = false, filters = [], actions = [], overflow = [], view } = {}) => {
    const id = `settings-row-${++rowSerial}`;
    return uiSettingsRow({ id, label: name, description: desc, line, descId: live?.id || '', readout, attrs: { 'data-find': `${name} ${desc} ${find}`.trim().toLowerCase() },
      ...(readout ? {} : { controls: { id: `${id}-bar`, label: name, filters, actions, overflow, ...(view ? { view } : {}) } }) });
  };
  const text = o => ({ type: 'field', width: 'flex', ...o });
  const choose = o => ({ type: 'select', ...o });
  // A saved key is never drawn back: the field is empty and the placeholder shows its end.
  const keyRow = (name, { id, key, desc }) => srow(name, { desc,
    filters: [{ type: 'field', id, label: name, inputType: 'password', width: 'flex', value: '', placeholder: key ? maskKey(key) : 'Paste key', attrs: off }],
    overflow: key ? [{ id: `${id}-remove`, label: 'Remove key', danger: true, disabled: readOnly, attrs: { 'data-key-clear': id } }] : [] });
  const overrideRow = (what, name, value) => srow(name, { desc: value, find: 'this project',
    actions: [{ id: `override-${rowSerial + 1}`, label: 'Use the app-wide value', attrs: { 'data-drop-override': what } }] });
  const bytes = section === 'project' ? new Blob([JSON.stringify(s)]).size : null;

  const swatch = t => `<button class="swatch${pref === t.id ? ' on' : ''}" data-theme-pick="${t.id}"
          role="radio" aria-label="${esc(t.label)}" aria-checked="${pref === t.id}">
          ${t.id === 'system'
            ? `<span class="sw sw-split" aria-hidden="true"><span class="sw" data-theme="paper">${mini()}</span>
               <span class="sw" data-theme="graphite">${mini()}</span></span>`
            : `<span class="sw" data-theme="${t.id}" aria-hidden="true">${mini()}</span>`}
          <span class="sw-caption"><span class="sw-name">${esc(t.label)}<small>${t.mode === 'dark' ? 'Dark' : t.mode === 'light' ? 'Light' : 'Automatic'}</small></span><span class="sw-check" aria-hidden="true">${icon('check', { size: 14 })}</span></span></button>`;

  const scheduledList = schedules().length ? uiList({ id: 'sc-list', label: 'Scheduled searches', cols: ['interval'], rows: schedules().map((sc, i) => uiRow({
        attrs: { 'data-find': `scheduled search ${sc.sourceName} ${sc.query}`.toLowerCase() },
        check: { checked: !!sc.enabled, label: `On: ${sc.sourceName}: ${sc.query}`, attrs: { 'data-sc-on': sc.id } },
        main: { html: esc(`${sc.sourceName}: ${sc.query}`), detail: [sc.pausedUntil && sc.pausedUntil > Date.now() ? `Paused until ${when(sc.pausedUntil)} · allowance used up`
          : sc.lastRun ? `Last run ${ago(sc.lastRun)} · ${sc.lastNew} new of ${sc.lastTotal} · next ${when(nextRun(sc))}` : 'Not run yet'].map(esc) },
        cells: [{ col: 'interval', kind: 'control', html: `<select data-sc-int="${esc(sc.id)}" aria-label="Interval">${INTERVALS.map(x => `<option value="${x.id}"${x.id === sc.interval ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` }],
        end: uiRowEnd({ primary: { id: `sc-run-${i}`, label: 'Run now', attrs: { 'data-sc-run': sc.id } }, more: { label: `More for ${sc.sourceName}: ${sc.query}`, attrs: { 'data-sc-more': sc.id } } }) })) })
        : srow('Searches', { readout: true, desc: 'None', find: 'scheduled searches' });

  const SECTIONS = [
    { id: 'appearance', group: 'Workspace', name: 'Appearance', icon: 'palette', body: `
      <div class="swatches" role="radiogroup" aria-label="Theme" data-find="theme appearance dark light">
        ${[{ id: 'system', label: 'Match system' }, ...THEMES].map(swatch).join('')}
      </div>` },

    { id: 'you', group: 'Workspace', name: 'You', icon: 'user', body: `
      ${appNote()}
      ${srow('Name', { desc: 'Recorded with your decisions in every project', filters: [text({ id: 's-name', label: 'Name', value: appValues().reviewerName, attrs: off })] })}
      ${srow('Initials', { desc: 'Shown in screening and extraction', filters: [text({ id: 's-initials', label: 'Initials', value: appValues().reviewerInitials, placeholder: 'Initials', attrs: off })] })}
      ${over.scalars.includes('reviewerName') ? overrideRow('reviewerName', 'Name in this project', s.settings.reviewerName) : ''}
      ${over.scalars.includes('reviewerInitials') ? overrideRow('reviewerInitials', 'Initials in this project', s.settings.reviewerInitials) : ''}` },

    // MCP access serves a project to a local agent through a bridge started on this computer: not drawn in a browser tab.
    ...(inHostedTab() ? [] : [{ id: 'mcp', group: 'Advanced', name: 'MCP access', icon: 'connector', body: '<div id="mcp-settings"></div>' }]),
    { id: 'engine', group: 'Advanced', name: 'R engine', icon: 'cpu', body: `
      ${srow('Status', { desc: 'Idle', live: { id: 'eng' }, actions: [{ id: 'warm', label: 'Start now', icon: 'run' }] })}
      ${srow('Runtime', { readout: true, desc: 'WebR (vendored)' })}
      ${srow('Packages loaded', { readout: true, desc: 'None yet', live: { id: 'pkgs' } })}
      ${srow('Release after idle', { desc: 'Loaded R packages are released when no work is running or queued',
        filters: [choose({ id: 'r-idle', label: 'Release after idle', options: IDLE_MINUTES.map(n => [n, `${n} ${n === 1 ? 'minute' : 'minutes'}`]), value: resourcePolicy().idleMinutes })] })}
      ${srow('Queue capacity', { filters: [choose({ id: 'r-queue', label: 'Queue capacity', options: [4, 8, 16, 32].map(n => [n, `${n} waiting analyses`]), value: resourcePolicy().maxPending })] })}
      ${srow('Memory', { live: { id: 'r-release-status' }, actions: [{ id: 'r-release', label: 'Release R now', icon: 'refresh' }] })}` },

    { id: 'sources', group: 'Review', name: 'Sources', icon: 'globe', body: `
      ${appNote()}
      ${srow('Stored', { readout: true, desc: keptHere })}
      ${srow('Contact email', { desc: 'Sent with PubMed requests, and to Unpaywall when no Unpaywall email is set', filters: [text({ id: 's-email', label: 'Contact email', value: appValues().ncbiEmail, placeholder: 'you@institution.edu', attrs: off })] })}
      ${keyRow('PubMed key', { id: 's-key', key: appValues().ncbiKey, desc: 'Raises the PubMed rate limit' })}
      ${keyRow('OpenAlex key', { id: 's-oakey', key: appValues().openalexKey, desc: 'Raises the daily allowance about tenfold' })}
      ${srow('SCImago journal ranks', { desc: 'Not imported', live: { id: 's-sjr-state' }, find: 'sjr quartile scimago impact factor journal rank',
        actions: [{ id: 's-sjr-import', label: 'Import SJR file…', icon: 'import' }], overflow: [{ id: 's-sjr-remove', label: 'Remove', danger: true }] })}
      ${inHostedTab() ? '' : keyRow('TinyFish search key', { id: 's-tinyfishkey', key: appValues().tinyfishKey, desc: 'Default chat web search, including OpenRouter models' })}
      ${inHostedTab() ? '' : keyRow('Brave search key', { id: 's-bravekey', key: appValues().braveKey, desc: 'Used when no TinyFish key is configured; Wikipedia works without a key' })}
      ${over.scalars.includes('ncbiEmail') ? overrideRow('ncbiEmail', 'Contact email in this project', s.settings.ncbiEmail) : ''}
      ${over.scalars.includes('ncbiKey') ? overrideRow('ncbiKey', 'API key in this project', maskKey(s.settings.ncbiKey)) : ''}` },

    // Folders on this computer for the assistant to read: where folders can be opened (lib/fsys.mjs canOpenFolders).
    ...(!canOpenFolders() ? [] : [{ id: 'folders', group: 'Workspace', name: 'Folders', icon: 'folder', body: `
      <div id="s-folders"></div>
      ${srow('Add folder', { actions: [{ id: 's-folder-add', label: 'Choose', icon: 'plus' }] })}` }]),

    { id: 'projects', group: 'Workspace', name: 'Projects', icon: 'projects', body: projectsBody() },
    // Paper retrieval (Unpaywall, PDF lookup URLs, mirrors) runs in the desktop shell: a browser tab does not draw the section.
    ...(inHostedTab() ? [] : [{ id: 'previews', group: 'Workspace', name: 'Paper previews', icon: 'file-pdf', body: `
      ${srow('Unpaywall email', { desc: 'Sent to Unpaywall to find open copies. Stays on this Mac.',
        filters: [text({ id: 's-unpaywall-email', label: 'Unpaywall contact email', value: '', inputType: 'email', placeholder: 'you@institution.edu' })] })}
      ${srow('Storage', { readout: true, desc: 'Temporary only · up to 32 MB' })}
      ${srow('PDF lookup URLs', { desc: plural(pdfSources.length, 'source'), actions: [{ id: 'pdf-source-add', label: 'Add source', icon: 'plus', disabled: pdfSources.length >= MAX_PDF_SOURCES }] })}
      ${pdfSources.length ? uiList({ id: 'pdf-sources', label: 'PDF lookup URLs', rows: pdfSources.map((source, i) => {
        const name = source.name || `Source ${i + 1}`;
        return uiRow({ attrs: { 'data-pdf-source': i, 'data-find': `${name} pdf lookup url ${source.template || ''}`.toLowerCase() },
          check: { checked: source.enabled !== false, label: `Use ${name}`, attrs: { 'data-pdf-enabled': true } },
          main: { html: `<span class="pdf-source-name">${esc(name)}</span><span class="pdf-source-status meta" role="status"></span>`, detail: [esc(source.template || '')] },
          end: uiRowEnd({ primary: { id: `pdf-test-${i}`, label: 'Test host', attrs: { 'data-pdf-test': true } }, more: { label: `More for ${name}`, attrs: { 'data-pdf-more': i } } }) });
      }) }) : ''}
      ${MIRRORS.map(([kind, name, placeholder], i) => srow(name, { desc: '', live: { id: `mirror-${kind}-result` }, find: 'paper download mirror sci-hub scidb anna archive pypaperbot',
        filters: [text({ id: `mirror-${kind}`, label: name, value: settings()[`${kind}Mirror`] || '', inputType: 'url', placeholder })],
        actions: [{ id: `mirror-${kind}-test`, label: 'Test', icon: 'run', attrs: { 'data-mirror-test': kind } }],
        overflow: i === MIRRORS.length - 1 ? [{ id: 'mirror-reset', label: 'Reset mirrors', attrs: { 'data-mirror-reset': true } }] : [] })).join('')}` }]),

    // Web links opened in Lykos with a session kept on this computer (src-tauri/src/browser.rs). A desktop feature: absent in the web build.
    ...(inDesktop() ? [{ id: 'browser', group: 'Workspace', name: 'Browser', icon: 'link', body: `
      ${srow('Open links in Lykos', { desc: 'Sign in to a publisher once. The session is kept on this computer.', live: { id: 'browser-links-note' }, find: 'browser links doi publisher sign in institutional login cookies session system browser',
        filters: [{ type: 'check', id: 'browser-links', label: 'On', value: openLinksInApp() }] })}
      ${srow('Browsing data', { desc: 'Cookies and site data of the Lykos browser', live: { id: 'browser-clear-note' }, find: 'browser cookies site data sign out clear',
        actions: [{ id: 'browser-clear', label: 'Clear browsing data' }] })}` }] : []),

    // What the app keeps on this machine, measured when this section is opened (views/settings-storage.mjs).
    { id: 'storage', group: 'Workspace', name: 'Storage', icon: 'storage', body: storageBody(srow) },

    { id: 'model', group: 'AI', name: 'Models', icon: 'models', body: (() => {
      const list = profiles(); const cur = list.find(p => p.id === editing) || list[0];
      const curOrigin = cur ? layers(s).origin.get(cur.id) : '';
      const tasksHere = taskScope === 'project' && !appOnly;
      const appTask = t => appValues().models.tasks[t] || (t === 'chat' ? appValues().models.tasks.assist : null) || list[0]?.id;
      const labelOf = x => x.label || x.model || x.provider;
      const account = cur?.provider === 'chatgpt' ? chatGptAccount(cur.id) : null;
      const chat = account?.connected;
      return `
      ${appNote()}
      ${list.length ? '' : srow('Set up a connection', { find: 'connect model wizard first run guided setup', actions: [{ id: 'ai-connect', label: 'Start setup', icon: 'models' }] })}
      ${srow('Connection', { find: 'profile model connection',
        actions: [{ picker: true, id: 'ai-profile-pick', label: 'Connection', value: cur?.label || cur?.model || cur?.provider || 'Choose connection' },
          { id: 'ai-profile-add', label: 'Add', icon: 'plus', menu: true }],
        overflow: cur ? [{ id: 'ai-profile-remove', label: 'Remove profile', danger: true }] : [] })}
      ${cur ? `
      ${curOrigin === 'override' ? overrideRow(`profile:${cur.id}`, 'Profile in this project', 'This project holds its own version of this profile') : ''}
      ${curOrigin === 'project' ? srow('Only in this project', { find: 'profile this project', actions: [{ id: 'profile-make-app', label: 'Use in every project', attrs: { 'data-make-app': cur.id } }] }) : ''}
      ${srow('Label', { filters: [text({ id: 'ai-label', label: 'Label', value: cur.label || '', placeholder: 'Name', attrs: off })] })}
      ${srow('Provider', { desc: configured(cur) ? 'Configured' : 'Not configured', live: { id: 'ai-status' },
        filters: [choose({ id: 'ai-provider', label: 'Provider', options: [['', 'None'], ...Object.entries(PROVIDERS).filter(([k]) => k !== 'chatgpt' || !inHostedTab() || cur.provider === k).map(([k, v]) => [k, v.label])], value: cur.provider || '', attrs: off })] })}
      ${cur.provider === 'chatgpt'
        ? srow('ChatGPT account', { live: { id: 'chatgpt-note' }, desc: inDesktop() ? `${account?.email || 'Not signed in'}${chat ? ` · ${account.planEnabled ? 'Using ChatGPT plan' : 'Plan permission disabled'}` : ''}` : 'Desktop app required',
          actions: [uiSwap({ id: 'chatgpt-slot', members: [{ id: 'chatgpt-signin', label: 'Continue with ChatGPT', disabled: !inDesktop() }, { id: 'chatgpt-cancel', label: 'Cancel sign-in', hidden: true }] })],
          overflow: chat ? [{ id: 'chatgpt-signout', label: 'Sign out' }] : [] })
          + srow('ChatGPT usage', { actions: [{ id: 'chatgpt-usage', label: 'Manage usage', icon: 'gauge' }] })
        : `${srow('Endpoint', { filters: [text({ id: 'ai-base', label: 'Endpoint', value: cur.base ?? '', placeholder: 'https://…', attrs: off })] })}
      ${keyRow('API key', { id: 'ai-key', key: cur.key, desc: keptIn })}
      ${cur.provider === 'anthropic' ? srow('Workspace ID', { find: 'anthropic workspace header key not scoped',
        filters: [text({ id: 'ai-workspace', label: 'Workspace ID', value: cur.workspaceId || '', placeholder: 'Optional', attrs: { autocomplete: 'off', spellcheck: 'false', ...off } })] }) : ''}`}
      ${srow('Model', { actions: [{ picker: true, id: 'ai-model-pick', label: 'Model', value: (cur.provider === 'chatgpt' ? chatGptCatalog(cur.id).find(m => m.id === cur.model)?.label : '') || cur.model || 'Choose model' }] })}
      ${srow('Model list', { live: { id: 'ai-models-note' }, actions: [{ id: 'ai-models', label: 'Load models', icon: 'refresh' }] })}
      ${srow('Test connection', { find: 'test connection check key endpoint', live: { id: 'ai-test-note' }, actions: [{ id: 'ai-test', label: 'Test connection', icon: 'run' }] })}` : ''}
      ${cur ? scopeBody(srow, cur, off) : ''}
      ${list.length ? `<h3 class="setl-subhead">Models by task</h3>
      ${appOnly ? '' : srow('Assign for', { find: 'task scope', view: { id: 'task-scope', label: 'Assign for', attr: 'data-task-scope', value: tasksHere ? 'project' : 'app', items: [['app', 'Every project'], ['project', 'This project']] } })}
      ${TASKS.map(([t, label]) => srow(label, tasksHere
        ? { actions: [{ picker: true, id: `task-route-${t}`, label: `${label} model`, value: `${modelFor(t).model || 'Choose model'}${modelFor(t).effort ? ` · ${effortLabel(modelFor(t).effort)}` : ''}`, attrs: { 'data-task-route': t, ...off } }] }
        : { filters: [choose({ id: `task-${t}`, label: `${label} model`, options: list.map((x, i) => [x.id, `${labelOf(x)}${i === 0 ? ' (default)' : ''}`]), value: appTask(t), attrs: { 'data-task': t, ...off } })] })).join('')}
      <p class="meta" data-ui-help>Unassigned tasks use the first profile. Compaction and Task notes use the cheapest priced profile, and Claude Haiku 5.5 on a Claude connection.</p>` : ''}
      ${appOnly ? '' : `<h3 class="setl-subhead">Behaviour</h3>
      ${srow('Length of notes', { desc: 'How long a model may make the notes and reasons it writes for screening',
        filters: [choose({ id: 's-ai-detail', label: 'Length of notes', options: [['brief', 'Brief'], ['standard', 'Standard'], ['full', 'Full']], value: s.settings?.aiDetail || 'standard', attrs: off })] })}
      ${srow('Local models only', { desc: 'Refuse any model connection that is not on this machine',
        filters: [{ type: 'check', id: 's-ai-local', label: 'On', value: !!s.settings?.aiLocalOnly, attrs: off }] })}
      <h3 class="setl-subhead">Run limits</h3>
      ${srow('Tool calls per run', { filters: [text({ id: 's-agent-calls', label: 'Tool calls per run', value: cfg.agent?.calls || 40, inputType: 'number', width: 'md', attrs: { min: 1, max: 400 } })] })}
      ${srow('Tokens per run', { filters: [text({ id: 's-agent-tokens', label: 'Tokens per run', value: cfg.agent?.tokens || 150000, inputType: 'number', width: 'md', attrs: { min: 1000, step: 1000 } })] })}
      ${srow('Parallel runs in a batch', { filters: [choose({ id: 's-agent-parallel', label: 'Parallel runs in a batch', options: [1, 2, 3, 4], value: cfg.agent?.parallel || 1 })] })}
      <h3 class="setl-subhead">Chat budget</h3>
      ${srow('Calls per turn', { desc: 'For chats without their own budget', live: { id: 's-chat-calls-note' }, find: 'chat budget model calls',
        filters: [text({ id: 's-chat-calls', label: 'Calls per turn', value: num(chatBudgetOf(cfg).calls), width: 'sm', attrs: { inputmode: 'numeric', autocomplete: 'off' } })] })}
      ${srow('Token ceiling', { desc: 'Measured between calls', live: { id: 's-chat-tokens-note' }, find: 'chat budget tokens',
        filters: [text({ id: 's-chat-tokens', label: 'Token ceiling', value: num(chatBudgetOf(cfg).tokens), width: 'md', attrs: { inputmode: 'numeric', autocomplete: 'off' } })] })}
      <h3 class="setl-subhead">Data summary budget</h3>
      ${srow('Calls per run', { desc: 'For Normalise on the Data summary', live: { id: 's-sum-calls-note' }, find: 'data summary normalise budget model calls',
        filters: [text({ id: 's-sum-calls', label: 'Calls per run', value: num(runBudgetOf(cfg).calls), width: 'sm', attrs: { inputmode: 'numeric', autocomplete: 'off' } })] })}
      ${srow('Token ceiling', { desc: 'Estimated before each run, measured between calls', live: { id: 's-sum-tokens-note' }, find: 'data summary normalise budget tokens',
        filters: [text({ id: 's-sum-tokens', label: 'Token ceiling', value: num(runBudgetOf(cfg).tokens), width: 'md', attrs: { inputmode: 'numeric', autocomplete: 'off' } })] })}`}`; })() },

    { id: 'usage', group: 'Advanced', name: 'AI usage', icon: 'gauge', body: `
      ${renderUsage(usage)}` },

    { id: 'sent', group: 'Advanced', name: 'Sent', icon: 'upload', body: sentBody(srow, s) },

    { id: 'screening', group: 'Review', name: 'Screening', icon: 'screening', body: `
      ${srow('Reviewers', { desc: cfg.dualScreening ? 'Decisions are hidden from each other until both are made' : '',
        filters: [choose({ id: 's-dual', label: 'Reviewers', options: [['', 'One reviewer'], ['1', 'Two reviewers, blinded']], value: cfg.dualScreening ? '1' : '' })] })}
      ${srow('Second model', { desc: 'Both models assess each record; disagreements are marked uncertain for a person. Calls double. Text-model proposals only.',
        filters: [choose({ id: 's-screen-second', label: 'Second model', options: [['', 'None'], ...profiles().filter(p => p.id !== modelFor('screen').id).map(p => [p.id, p.label || p.model || p.provider])], value: cfg.screenSecond || '' })] })}
      ${srow('Deciding as', { filters: [text({ id: 's-initials2', label: 'Deciding as', value: cfg.reviewerInitials, placeholder: 'Initials', width: 'md' })],
        overflow: over.scalars.includes('reviewerInitials') ? [{ id: 'initials-app-wide', label: 'Use the app-wide value', attrs: { 'data-drop-override': 'reviewerInitials' } }] : [] })}` },

    { id: 'analysis', group: 'Review', name: 'Analysis', icon: 'analysis', body: `
      ${srow('Effect measure', { filters: [choose({ id: 's-measure', label: 'Effect measure', options: MEASURES.map(m => [m.id, m.label]), value: cfg.measure })] })}
      ${srow('Meta-analysis model', { filters: [choose({ id: 's-method', label: 'Meta-analysis model', options: [['REML', 'Random effects · REML'], ['DL', 'Random effects · DerSimonian–Laird'], ['EE', 'Common effect']], value: cfg.method })] })}
      ${srow('Reference style', { desc: jctx.citationStyle === 'numbered' ? 'Numbered by first appearance' : 'Author–year in text',
        filters: [choose({ id: 's-refstyle', label: 'Reference style', options: [['auto', autoLabel], ...STYLES.map(st => [st.id, st.label])], value: jctx.source === 'manual' ? jctx.referenceStyle : 'auto' })] })}
      ${srow('Retraction check', { desc: 'An older check is due again before submission', find: 'retraction correction crossref pubmed freshness',
        filters: [choose({ id: 's-retract-days', label: 'Retraction check', options: [7, 14, 30, 60, 90].map(n => [n, `Every ${n} days`]), value: freshDays(cfg) })] })}` },

    { id: 'workflows', group: 'Advanced', name: 'Workflows', icon: 'workflow', body: `
      ${srow('Saved workflows', { desc: plural((get().workflows || []).length, 'workflow'), find: 'automation pipeline run', actions: [{ id: 'open-workflows', label: 'Open workflows', icon: 'workflow' }] })}` },
    { id: 'scheduled', group: 'Advanced', name: 'Scheduled searches', icon: 'clock', body: `
      ${scheduledList}
      <h3 class="setl-subhead">Job log</h3>
      ${srow('Entries', { readout: true, desc: String(jobs().length), find: 'jobs log history' })}
      ${jobs().length ? uiList({ label: 'Job log', rows: jobs().slice(0, 30).map(jobRow) }) : ''}` },
    { id: 'project', group: 'Project', name: 'General', icon: 'file', body: `
      ${srow('Name', { filters: [text({ id: 's-project-name', label: 'Project name', value: projectName(s), placeholder: 'Project name', maxlength: 160, attrs: inProject ? {} : { disabled: true } })] })}
      ${srow('Research type', { filters: [choose({ id: 's-project-type', label: 'Research type', options: RESEARCH_TYPES.map(t => [t.id, t.label]), value: researchType(s).id, attrs: inProject ? {} : { disabled: true } })] })}
      ${srow('Target journal', { desc: targetJournal(s) ? [jctx.note, jctx.profileFrom === 'target' ? `Journal profile: ${jctx.profile.name}` : ''].filter(Boolean).join(' · ') : '', actions: [{ picker: true, id: 's-target-journal', label: 'Target journal', value: targetJournal(s) || 'Choose a journal' }] })}
      ${srow('Other journals', { desc: otherJournals(s).length ? plural(otherJournals(s).length, 'journal') : 'None', actions: [{ id: 'journal-add', label: 'Add journal', icon: 'plus' }] })}
      ${otherJournals(s).length ? uiList({ id: 'journal-list', label: 'Other journals', rows: otherJournals(s).map((j, i) => uiRow({
        attrs: { 'data-find': `other journals ${j}`.toLowerCase() }, main: { html: esc(j) },
        end: uiRowEnd({ inline: { id: `journal-change-${i}`, label: `Change ${j}`, icon: 'note', attrs: { 'data-journal-change': i } }, more: { label: `More for ${j}`, attrs: { 'data-journal-more': i } } }) })) }) : ''}
      ${srow('Individual patient data', { filters: [{ type: 'check', id: 's-project-patients', label: 'Show in workflow', value: patientDataEnabled(s), attrs: inProject ? {} : { disabled: true } }] })}
      ${srow('Dismissed suggestions', { desc: dismissedCount(s) ? plural(dismissedCount(s), 'suggested task') : 'None', live: { id: 's-dismissed-n' }, find: 'tasks suggested dismissed',
        overflow: [{ id: 's-dismissed-clear', label: 'Clear', disabled: !dismissedCount(s) || !inProject }] })}
      <h3 class="setl-subhead">Files and recovery</h3>
      ${srow('Size', { readout: true, desc: `${plural(s.papers.length, 'record')} · ${plural(Object.keys(s.values).length, 'value')} · ${bytes == null ? '—' : `${(bytes / 1024).toFixed(0)} KB`}` })}
      ${srow('Project file', { actions: [{ id: 'export', label: 'Export', icon: 'export' }],
        overflow: [{ id: 'import', label: 'Import' }, { id: 'reset', label: 'Reset project', danger: true }] })}
      ${srow('Backup', { desc: 'One file with the project and its PDFs, images and assets', actions: [{ id: 'backup-project', label: 'Back up project…', icon: 'backup' }],
        overflow: [{ id: 'restore-backup', label: 'Restore from backup…' }] })}
      ${srow('Automatic safety copy', { desc: '', live: { id: 'backup-health' }, actions: [{ id: 'retry-safety-copy', label: 'Retry safety copy', icon: 'refresh', disabled: true }] })}
      ${srow('Recovery copies', { readout: true, desc: '', live: { id: 'recovery-count' } })}
      <div id="recovery-list"></div>
      ${srow('Stored figures', { desc: '', live: { id: 'figure-status' }, actions: [{ id: 'figure-clean', label: 'Clean up figures', icon: 'trash', disabled: true }] })}
      <div class="note" id="pstatus"></div>` },
    ...(get().project ? [{ id: 'teams', group: 'AI', name: 'Teams', icon: 'fanout', body: teamsBody(srow) }] : []),
    // What the keys do, and what the app is made of: read pages, so they are sections here and not dialogs.
    { id: 'keyboard', group: 'Workspace', name: 'Keyboard', icon: 'keyboard', body: tableRegion({ label: 'Keyboard shortcuts', html: `<table class="sc-table"><thead><tr><th scope="col">Keys</th><th scope="col">Does</th></tr></thead><tbody>${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>` }) },
    { id: 'about', group: 'Workspace', name: 'About', icon: 'book', body: `${srow('Version', { readout: true, desc: '', live: { id: 'about-version' } })}${inDesktop() ? srow('Updates', { desc: updateText(), live: { id: 'about-update' },
      actions: [uiSwap({ id: 'update-slot', members: [{ id: 'update-check', label: 'Check for updates' }, { id: 'update-restart', label: 'Restart to update', hidden: true }] })] }) : ''}<div class="about-sections" id="about-sections"></div>` },
    // The project list, managed (views/projects-panel.mjs).
  ];

  // General leads the Project group.
  const general = SECTIONS.findIndex(x => x.id === 'project');
  if (general > 0) SECTIONS.unshift(...SECTIONS.splice(general, 1));
  const groups = [...new Set(SECTIONS.map(x => x.group))].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  if (!SECTIONS.some(x => x.id === section)) section = SECTIONS[0].id;
  const categoryItem = x => `<button class="setl-item${x.id === section ? ' on' : ''}" data-sec="${x.id}"${x.id === section ? ' aria-current="page"' : ''}
    >${icon(x.icon || 'file', { size: 16 })}<span>${esc(x.name)}</span></button>`;
  const category = g => `<div class="setl-group">${esc(g)}</div>${SECTIONS.filter(x => x.group === g).map(categoryItem).join('')}`;
  el.innerHTML = `<div class="setl">
    <nav class="setl-nav" aria-label="Settings categories">
      ${uiBar({ kind: 'tools', label: 'Search settings', id: 'set-search-bar', cls: 'setl-search', filters: [{ type: 'search', id: 'set-search', label: 'Search settings', placeholder: 'Search', width: 'flex', attrs: { spellcheck: 'false' } }] })}
      <div class="setl-mobile"><label for="set-section">Category</label><select id="set-section">
        ${groups.map(g => `<optgroup label="${esc(g)}">${SECTIONS.filter(x => x.group === g).map(x =>
          `<option value="${x.id}"${x.id === section ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}
      </select></div>
      <div class="setl-categories">${groups.map(category).join('')}</div>
    </nav>
    <div class="setl-body ui-flush" id="setbody">
      ${SECTIONS.map(x => `<section data-sec="${x.id}" aria-labelledby="settings-${x.id}"${x.id === section ? '' : ' hidden'}>
        <h2 id="settings-${x.id}">${esc(x.name)}</h2>${x.body}</section>`).join('')}
      <div class="empty-state" id="set-none" hidden>${icon('search', { size: 20 })}
        <div>No matching settings</div></div>
    </div></div>`;

  if (el.querySelector('#mcp-settings')) renderMcp(el.querySelector('#mcp-settings'), ctx);
  el.querySelector('#open-workflows')?.addEventListener('click', () => ctx.go('workflows'));
  el.querySelectorAll('.setl-item').forEach(b => {
    // The category list keeps its place (the repaint restores it); the new section opens at its top.
    b.onclick = () => { section = b.dataset.sec; ctx.rerender(); document.getElementById('setbody')?.scrollTo({ top: 0 }); };
  });
  el.querySelector('#set-section').onchange = e => { section = e.target.value; ctx.rerender(); };
  el.querySelectorAll('[data-theme-pick]').forEach(button => {
    button.onclick = () => {
      setTheme(button.dataset.themePick);
      el.querySelectorAll('[data-theme-pick]').forEach(choice => {
        const selected = choice === button;
        choice.classList.toggle('on', selected);
        choice.setAttribute('aria-checked', String(selected));
      });
    };
  });

  // Search looks across every category at once, so a setting is findable
  // without knowing which category it was filed under.
  const search = el.querySelector('#set-search');
  // A result is the row's name and the section it is in: the descriptions are left out while searching.
  const descriptions = row => row.querySelectorAll('.ui-settings-text>.meta, .srow-desc');
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    const secs = [...el.querySelectorAll('.setl-body section')];
    let shown = 0;
    for (const sec of secs) {
      if (!q) { sec.hidden = sec.dataset.sec !== section; continue; }
      const categoryMatch = SECTIONS.find(x => x.id === sec.dataset.sec).name.toLowerCase().includes(q);
      let any = categoryMatch;
      for (const r of sec.querySelectorAll('[data-find]')) {
        const hit = categoryMatch || r.dataset.find.includes(q);
        r.hidden = !hit;
        any = any || hit;
      }
      sec.hidden = !any;
      if (any) shown++;
    }
    for (const r of el.querySelectorAll('[data-find]')) { if (!q) r.hidden = false; for (const d of descriptions(r)) d.hidden = !!q; }
    el.querySelector('#set-none').hidden = !q || shown > 0;
    el.querySelectorAll('.setl-subhead, .setl-body [data-ui-help]').forEach(h => { h.hidden = !!q; });
    if (el.querySelector('#mcp-settings')) renderMcp(el.querySelector('#mcp-settings'), ctx);
    el.querySelectorAll('.setl-item').forEach(b => {
      const active = !q && b.dataset.sec === section;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  };

  const eng = el.querySelector('#eng');
  const pkgs = el.querySelector('#pkgs');
  const shown = installed();
  if (shown.length) { eng.textContent = 'ready'; pkgs.textContent = shown.join(', '); }

  el.querySelector('#warm').onclick = async () => {
    const button = el.querySelector('#warm'); button.disabled = true;
    try { eng.textContent = 'Starting'; await engine(['metafor'], m => eng.textContent = m); eng.textContent = 'Ready'; pkgs.textContent = installed().join(', '); }
    catch (error) { eng.textContent = error.message; }
    finally { button.disabled = false; }
  };
  for (const id of ['r-idle','r-queue']) el.querySelector(`#${id}`).onchange = () => setResourcePolicy({ idleMinutes: Number(el.querySelector('#r-idle').value), maxPending: Number(el.querySelector('#r-queue').value) });
  el.querySelector('#r-release').onclick = async () => { const released = await releaseR(); el.querySelector('#r-release-status').textContent = released ? 'Released' : 'An analysis is running or queued'; if (released) { eng.textContent = 'Idle'; pkgs.textContent = 'None yet'; } };
  const drawBackup = () => { const b = backupState(), out = el.querySelector('#backup-health'); out.textContent = b.status === 'failed' ? `Failed: ${b.error}` : b.status === 'current' ? `Current · ${when(b.at)}` : b.status === 'running' ? 'Saving safety copy' : b.status === 'pending' ? 'Pending' : 'Available in the desktop app or a writable project folder'; el.querySelector('#retry-safety-copy').disabled = b.status !== 'failed'; };
  drawBackup();
  el.querySelector('#retry-safety-copy').onclick = async e => { e.currentTarget.disabled = true; try { await retryBackup(); } catch (error) { el.querySelector('#backup-health').textContent = error.message; return; } finally { drawBackup(); } };

  const save = saveOwn;
  const saveProject = patch => update(st => {
    st.project = { name: projectName(st), mode: projectMode(st) || 'workspace',
      patientData: patientDataEnabled(st), ...(st.project || {}), ...patch };
    return st;
  });
  el.querySelector('#s-project-name').onchange = e => {
    const name = e.target.value.trim();
    // The project's name is the manuscript's working title (setup asks for one), so Protocol shows it too.
    if (name) { saveProject({ name }); update(st => { st.paper = { ...(st.paper || {}), title: name }; return st; }); }
    else e.target.value = projectName(get());
  };
  el.querySelector('#s-project-type').onchange = e => {
    const type = RESEARCH_TYPES.find(t => t.id === e.target.value);
    // Patient data follows the type unless it was switched on by hand.
    if (type) { saveProject({ researchType: type.id, mode: type.mode, patientData: !!type.patientData || !!get().project?.patientDataManual }); ctx.rerender(); }
  };
  // The same list Protocol and setup write: the target first, then the others.
  wireJournalButton(el.querySelector('#s-target-journal'), () => targetJournal(get()), choice => {
    const msg = changeTarget({ get, update }, [choice.label, ...otherJournals(get()).filter(x => x !== choice.label)], choice);
    ctx.rerender();
    if (msg) ctx.say?.(msg);   // after the repaint, which redraws the title bar's line
  });
  const setOthers = change => { update(st => { const others = otherJournals(st); change(others); return setJournals(st, [targetJournal(st), ...others]); }); ctx.rerender(); };
  el.querySelectorAll('[data-journal-change]').forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.journalChange), choice = await chooseJournal({ current: otherJournals(get())[i] || '' });
    if (choice?.label) setOthers(o => { o[i] = choice.label; });
  });
  el.querySelectorAll('[data-journal-more]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Remove journal', icon: 'trash', danger: true, run: () => setOthers(o => o.splice(Number(b.dataset.journalMore), 1)) }], { align: 'end' }));
  el.querySelector('#journal-add').onclick = async () => {
    const choice = await chooseJournal();
    if (choice?.label) setOthers(o => o.push(choice.label));
  };
  el.querySelector('#s-project-patients').onchange = e => saveProject({ patientData: e.target.checked, patientDataManual: e.target.checked });
  // suggested tasks removed from Proposals with their rows cleared are not suggested again; Clear lets them come back
  el.querySelector('#s-dismissed-clear')?.addEventListener('click', () => { clearDismissed(); ctx.rerender(); });

  // ---- PDF lookup URLs: a list, each source edited in one dialog; the paper download mirrors are two rows of Paper previews
  const sourceList = () => Array.isArray(settings().pdfSources) ? settings().pdfSources.slice() : [];
  const saveSourceList = list => save('pdfSources', list);
  const duplicateSource = (list, template, except = -1) => list.some((x, i) => i !== except && x.template === template);
  /** The name and URL template of one source in a dialog; resolves to the source, or null. `index` -1 adds one. */
  const editSource = index => {
    const have = index >= 0 ? sourceList()[index] : { name: '', template: '' };
    return formDialog({ id: 'pdf-source', title: index >= 0 ? 'Edit source' : 'Add source', tier: 'S', confirm: index >= 0 ? 'Save' : 'Add',
      body: `${formField('Name', `<input name="name" value="${esc(have.name || '')}" placeholder="Name" spellcheck="false" autocomplete="off">`)}
      ${formField('URL template', `<input name="template" type="text" inputmode="url" value="${esc(have.template || '')}" placeholder="https://repository.org/{doi}" spellcheck="false" autocomplete="off">`)}
      <p class="meta" id="pdf-edit-status" role="status"></p>`,
      submit: (form, d) => {
        try {
          const list = sourceList(), values = formValues(form);
          if (index < 0 && list.length >= MAX_PDF_SOURCES) throw new Error(`At most ${MAX_PDF_SOURCES} sources`);
          const source = pdfSource({ ...(index >= 0 ? list[index] : { id: `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }), name: values.name, template: values.template });
          if (duplicateSource(list, source.template, index)) throw new Error('Source URL already listed');
          return source;
        } catch (error) { d.querySelector('#pdf-edit-status').textContent = error.message; return undefined; }
      } });
  };
  // Paper previews is not drawn in a browser tab (the section above), so its controls are wired only where they exist.
  if (el.querySelector('#pdf-source-add')) {
    el.querySelector('#pdf-source-add').onclick = async () => {
      const source = await editSource(-1);
      if (source) { saveSourceList([...sourceList(), source]); ctx.rerender(); }
    };
    el.querySelectorAll('[data-pdf-source]').forEach(rowEl => {
      const index = Number(rowEl.dataset.pdfSource), status = rowEl.querySelector('.pdf-source-status');
      rowEl.querySelector('[data-pdf-enabled]').onchange = e => { const list = sourceList(); list[index] = { ...list[index], enabled: e.target.checked }; saveSourceList(list); };
      rowEl.querySelector('[data-pdf-more]').onclick = e => { const n = sourceList().length; showMenu(e.currentTarget, [
        { label: 'Edit', icon: 'note', run: async () => { const source = await editSource(index); if (source) { const list = sourceList(); list[index] = source; saveSourceList(list); ctx.rerender(); } } },
        { label: 'Move up', icon: 'arrow-up', disabled: index === 0, run: () => { const list = sourceList(); [list[index - 1], list[index]] = [list[index], list[index - 1]]; saveSourceList(list); ctx.rerender(); } },
        { label: 'Move down', icon: 'arrow-down', disabled: index >= n - 1, run: () => { const list = sourceList(); [list[index], list[index + 1]] = [list[index + 1], list[index]]; saveSourceList(list); ctx.rerender(); } }, '-',
        { label: 'Remove source', icon: 'trash', danger: true, run: () => { const list = sourceList(); list.splice(index, 1); saveSourceList(list); ctx.rerender(); } }], { align: 'end' }); };
      rowEl.querySelector('[data-pdf-test]').onclick = async e => {
        const button = e.currentTarget;
        try {
          const source = pdfSource(sourceList()[index]);
          if (!inDesktop()) throw new Error('Desktop app required');
          button.disabled = true; status.textContent = 'Testing…';
          const sample = source.template.replace(/\{(?:doi|pmid|title)\}/g, 'paper');
          const result = await testPaperMirrorNative(new URL(sample).origin);
          status.textContent = `${result.code} — ${result.reason}`;
        } catch (error) { status.textContent = error.message || String(error); }
        finally { button.disabled = false; }
      };
    });
    // The paper download mirrors: Sci-Hub and SciDB, a row each in Paper previews. Empty fields use the PyPaperBot defaults (paperbot.py).
    const mirrorURL = (kind, value) => {
      const url = value.trim();
      if (kind === 'scidb' && url) { try { const p = new URL(url); if (p.pathname === '/' && !p.search && !p.hash) { p.pathname = '/scidb/'; return p.href; } } catch {} }
      return url;
    };
    for (const [kind, , placeholder] of MIRRORS) {
      const input = el.querySelector(`#mirror-${kind}`), result = el.querySelector(`#mirror-${kind}-result`);
      input.onchange = () => { const value = mirrorURL(kind, input.value); input.value = value; save(`${kind}Mirror`, value); };
      el.querySelector(`[data-mirror-test="${kind}"]`).onclick = async e => {
        const b = e.currentTarget, url = mirrorURL(kind, input.value) || placeholder;
        b.disabled = true; result.textContent = 'Testing connection…';
        try {
          if (!inDesktop()) throw new Error('Desktop app required');
          const data = await testPaperMirrorNative(url);
          result.textContent = `${data.code} — ${data.reason}${data.milliseconds ? ` · ${data.milliseconds} ms` : ''}`;
        } catch (err) { result.textContent = `Failed — ${err.message || err}`; }
        finally { b.disabled = false; }
      };
    }
    el.querySelector('#mirror-reset')?.addEventListener('click', () => { for (const [kind] of MIRRORS) { save(`${kind}Mirror`, ''); el.querySelector(`#mirror-${kind}`).value = ''; el.querySelector(`#mirror-${kind}-result`).textContent = ''; } });
  }
  // ---- model profiles
  const saveProfiles = list => setProfiles(list);
  const cur = () => { const l = profiles(); return l.find(p => p.id === editing) || l[0]; };
  const saveAi = (k, v) => {
    const list = profiles().map(p => ({ ...p })); const c = list.find(p => p.id === cur()?.id); if (!c) return;
    c[k] = v; saveProfiles(list);
  };
  const replaceAi = transform => {
    const list = profiles(); const id = cur()?.id;
    saveProfiles(list.map(p => p.id === id ? transform(p, list) : p));
  };
  const aiStatus = el.querySelector('#ai-status');
  const showConfigured = () => { if (aiStatus) aiStatus.textContent = configured(cur()) ? 'Configured' : 'Not configured'; };
  showConfigured();
  // What a model request answered belongs to the row it concerns: Model list for loading and testing, the account row for ChatGPT.
  // The note is the short readable form; the provider's own words are its tooltip. It is gone as soon as the connection changes.
  const noteOf = id => { const n = el.querySelector(id); if (n) n.hidden = true; return (text, full = '') => {
    if (!n) return; n.textContent = text; n.hidden = !text; if (full) n.title = full; else n.removeAttribute('title'); }; };
  const sayModels = noteOf('#ai-models-note'), sayTest = noteOf('#ai-test-note'), sayAccount = (() => { const n = el.querySelector('#chatgpt-note'), was = n?.textContent || '';
    return (text, full = '') => { if (!n) return; n.textContent = text || was; if (full) n.title = full; else n.removeAttribute('title'); }; })();
  const problem = (say, err) => { const { text, full } = problemOf(err); say(text, full); };
  const selectProfile = choice => {
    if (choice === 'or') { askOpenRouterModel().then(id => { if (id) { editing = id; ctx.rerender(); } }); return; }
    if (choice === '+' || choice === 'chatgpt' || choice === 'anthropic') {
      const list = profiles().map(p => ({ ...p })); const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const oauth = choice === 'chatgpt';
      const blank = { id, label: oauth ? 'ChatGPT' : choice === 'anthropic' ? 'Claude' : `Profile ${list.length + 1}`, provider: oauth ? 'chatgpt' : '', base: oauth ? PROVIDERS.chatgpt.base : '', key: '', model: '' };
      list.push(choice === 'anthropic' ? changeProfileProvider(blank, 'anthropic', list) : blank);
      saveProfiles(list); editing = id;
    } else editing = choice;
    ctx.rerender();
  };
  // The guided setup adds one profile (app-wide, key in the credentials store like any other) and opens it; a ChatGPT account then signs in.
  const startWizard = async () => {
    const out = await connectWizard();
    if (!out) return;
    saveProfiles([...profiles().map(p => ({ ...p })), out.profile]); editing = out.profile.id;
    ctx.rerender(out.signIn ? '' : 'Connection added');
    if (out.signIn) document.getElementById('chatgpt-signin')?.click();
  };
  el.querySelector('#ai-connect')?.addEventListener('click', startWizard);
  el.querySelector('#ai-profile-pick')?.addEventListener('click', e => showMenu(e.currentTarget, profiles().map(p => ({ label: p.label || p.model || p.provider || 'Profile', checked: p.id === cur()?.id, run: () => selectProfile(p.id) }))));
  if (el.querySelector('section[data-sec="teams"]')) wireTeams(el, ctx);
  el.querySelector('#ai-profile-add')?.addEventListener('click', e => showMenu(e.currentTarget, [
    { label: 'Guided setup…', run: () => startWizard() },
    // ChatGPT sign-in runs in the desktop app only (lib/chatgpt.mjs); a browser tab does not offer it.
    ...(inHostedTab() ? [] : [{ label: 'ChatGPT subscription', run: () => selectProfile('chatgpt') }]),
    { label: 'Claude API', run: () => selectProfile('anthropic') },
    { label: 'API or local model', run: () => selectProfile('+') },
    ...(openRouterSource() ? [{ label: 'OpenRouter model', run: () => selectProfile('or') }] : []),
  ]));
  el.querySelector('#ai-profile-remove')?.addEventListener('click', async () => {
    const c = cur(); if (!c) return;
    let revocationNote = '';
    if (c.provider === 'chatgpt' && chatGptAccount(c.id)?.connected) {
      try { const result = await signOutChatGpt(c.id); if (!result.revoked) revocationNote = REVOKE_NOTE; }
      catch (err) { ctx.say?.(problemOf(err).text); return; }
    }
    saveProfiles(profiles().filter(p => p.id !== c.id)); editing = ''; ctx.rerender(revocationNote);
    el.querySelector('#ai-profile-pick, #ai-profile-add')?.focus();
  });
  el.querySelectorAll('[data-task]').forEach(sel => sel.onchange = () => {
    setTaskModel(sel.dataset.task, sel.value, taskScope === 'project' && !appOnly ? 'project' : 'app');
    ctx.rerender();
  });
  el.querySelectorAll('[data-task-route]').forEach(button => button.onclick = () => {
    const task=button.dataset.taskRoute, identity=get().project;
    showMenu(button,[...quickModelItems(modelFor(task),{profiles:profiles(),change:route=>{if(get().project===identity){setTaskRoute(task,route);ctx.rerender();}}}),
      {label:'Use app task default',run:()=>{if(get().project===identity){setTaskModel(task,'','project');ctx.rerender();}}}]);
  });
  el.querySelectorAll('[data-task-scope]').forEach(b => b.onclick = () => { taskScope = b.dataset.taskScope; ctx.rerender(); });
  el.querySelectorAll('[data-drop-override]').forEach(b => b.onclick = () => { putOwn(withoutOverride(get().settings, b.dataset.dropOverride)); ctx.rerender(); });
  el.querySelectorAll('[data-make-app]').forEach(b => b.onclick = () => { makeProfileAppWide(b.dataset.makeApp); ctx.rerender(); });
  const saveAgent = (k, v) => save('agent', { ...(settings().agent || {}), [k]: v });
  el.querySelector('#s-ai-detail')?.addEventListener('change', e => saveOwn('aiDetail', e.target.value));
  el.querySelector('#s-ai-local')?.addEventListener('change', e => saveOwn('aiLocalOnly', e.target.checked));
  wireScope(el, cur, ctx);
  wireSent(el, ctx);
  el.querySelector('#s-agent-calls')?.addEventListener('input', e => saveAgent('calls', Number(e.target.value) || 40));
  el.querySelector('#s-agent-tokens')?.addEventListener('input', e => saveAgent('tokens', Number(e.target.value) || 150000));
  el.querySelector('#s-agent-parallel')?.addEventListener('change', e => saveAgent('parallel', Number(e.target.value) || 1));
  // The chat budget's defaults: a value out of bounds is not saved; the row's note says why until it is corrected.
  for (const [key, note] of [['calls', 'For chats without their own budget'], ['tokens', 'Measured between calls']]) {
    const input = el.querySelector(`#s-chat-${key}`), live = el.querySelector(`#s-chat-${key}-note`);
    input?.addEventListener('change', () => {
      const next = { ...chatBudgetOf(settings()), [key]: budgetNumber(input.value) }, wrong = budgetProblem(next);
      input.toggleAttribute('aria-invalid', !!wrong); if (live) live.textContent = wrong ? wrong.replace(/^[^:]*: /, '') : note;   // the row names the field
      if (wrong) return;
      save('chatBudget', next); input.value = num(next[key]); ctx.say?.('Budget saved');
    });
  }
  // The Data summary's run budget: the same two bounds as the chat's, worded for a run.
  for (const [key, note] of [['calls', 'For Normalise on the Data summary'], ['tokens', 'Estimated before each run, measured between calls']]) {
    const input = el.querySelector(`#s-sum-${key}`), live = el.querySelector(`#s-sum-${key}-note`);
    input?.addEventListener('change', () => {
      const next = { ...runBudgetOf(settings()), [key]: budgetNumber(input.value) }, wrong = runBudgetProblem(next);
      input.toggleAttribute('aria-invalid', !!wrong); if (live) live.textContent = wrong ? wrong.replace(/^[^:]*: /, '') : note;
      if (wrong) return;
      save('summaryBudget', next); input.value = num(next[key]); ctx.say?.('Budget saved');
    });
  }
  el.querySelector('#ai-label')?.addEventListener('input', e => saveAi('label', e.target.value));
  el.querySelector('#ai-provider')?.addEventListener('change', e => {
    replaceAi((p, list) => changeProfileProvider(p, e.target.value, list));
    ctx.rerender();
  });
  el.querySelector('#ai-base')?.addEventListener('input', e => {
    replaceAi((p, list) => defaultProfileKey({ ...p, base: connectionBase(e.target.value),
      ...(p.keyInherited ? { key: '', keyInherited: false } : {}) }, list));
    const key = el.querySelector('#ai-key'); if (key) key.placeholder = maskKey(cur()?.key) || 'Paste key';
    sayModels(''); sayTest('');
    showConfigured();
  });
  // A key is taken when the field is left, not on each character, and the field never shows the saved one.
  // The workspace id goes out as a header with the key's requests to Anthropic; an id that could not be a header is not kept.
  el.querySelector('#ai-workspace')?.addEventListener('input', e => {
    const id = e.target.value.trim(), ok = /^[\x21-\x7e]*$/.test(id);
    e.target.toggleAttribute('aria-invalid', !ok); sayModels(''); sayTest('');
    if (ok) saveAi('workspaceId', id);
  });
  el.querySelector('#ai-key')?.addEventListener('change', e => {
    const key = e.target.value.trim(); e.target.value = '';
    if (!key) return;
    replaceAi(p => ({ ...p, key, keyEdited: true, keyInherited: false }));
    ctx.rerender();
  });
  el.querySelector('[data-key-clear="ai-key"]')?.addEventListener('click', () => {
    replaceAi(p => ({ ...p, key: '', keyEdited: true, keyInherited: false }));
    ctx.rerender();
  });
  el.querySelector('#chatgpt-usage')?.addEventListener('click', () => openChatGptUsage());
  el.querySelector('#chatgpt-signin')?.addEventListener('click', async e => {
    const id = cur()?.id; if (!id) return;
    const button = e.currentTarget, cancel = el.querySelector('#chatgpt-cancel'); sayAccount('Complete sign-in in your browser');
    cancel.onclick = () => chatGptCancelSigninNative().catch(() => {});
    button.hidden = true; cancel.hidden = false;
    let planNote = '';
    try {
      const account = await signInChatGpt(id);
      if (account.planEnabled) {
        if (account.firstUse) planNote = 'Eligible requests use your ChatGPT plan or credits. Manage usage in ChatGPT settings.';
        const models = await PROVIDERS.chatgpt.listModels({ id });
        saveProfiles(profiles().map(p => p.id === id ? { ...p, models, model: models.includes(p.model) ? p.model : models[0] || '' } : p));
      }
      ctx.rerender(planNote);
    } catch (err) { problem(sayAccount, err); }
    finally { cancel.hidden = true; button.hidden = false; }
  });
  el.querySelector('#chatgpt-signout')?.addEventListener('click', async e => {
    const id = cur()?.id; e.currentTarget.disabled = true;
    try { const result = await signOutChatGpt(id); ctx.rerender(result.revoked ? '' : REVOKE_NOTE);
    } catch (err) { problem(sayAccount, err); e.currentTarget.disabled = false; }
  });
  el.querySelector('#ai-model-pick')?.addEventListener('click', async e => {
    const button = e.currentTarget, profile = cur();
    if (!profile || button.getAttribute('aria-expanded') === 'true') return;
    button.setAttribute('aria-expanded', 'true');
    const model = await chooseModel({ models: profile.provider === 'chatgpt' && chatGptCatalog(profile.id).length ? chatGptCatalog(profile.id).map(m=>m.id) : profile.models?.length ? profile.models : profile.provider === 'anthropic' ? cachedModels(profile).map(m => m.id) : [], current: profile.model || '', labels: Object.fromEntries(cachedModels(profile).map(m => [m.id, m.label || m.id])), allowCustom: profile.provider !== 'chatgpt',
      load: profile.provider === 'chatgpt' && !chatGptCatalog(profile.id).length ? () => listModelsDetailed(profile, { force: false }) : null });
    button.setAttribute('aria-expanded', 'false');
    if (button.isConnected) button.focus();
    if (model == null || !button.isConnected || cur()?.id !== profile.id) return;
    saveAi('model', model);
    button.querySelector('span').textContent = chatGptCatalog(profile.id).find(m => m.id === model)?.label || model;
    showConfigured();
  });
  el.querySelector('#ai-models')?.addEventListener('click', async e => {
    const button = e.currentTarget; if (button.disabled) return; button.disabled = true;
    const c = cur(), p = PROVIDERS[c?.provider];
    if (!p) { sayModels('Choose a provider first'); button.disabled = false; return; }
    sayModels('Loading models…');
    try {
      const models = (await listModelsDetailed(c, { force: true })).map(m => m.id);
      saveAi('models', models);   // kept with the profile, so the list is there next time without a call
      ctx.rerender();   // the row is drawn again without its note
    } catch (err) { problem(sayModels, err); }
    finally { button.disabled = false; }
  });
  // Test connection answers in its own row, and only for the connection it was pressed on: if the profile or its address, key or model
  // changed while it ran, the answer is dropped, so it can never describe (or appear under) another connection.
  el.querySelector('#ai-test')?.addEventListener('click', async e => {
    const button = e.currentTarget, c = cur(); if (!c || button.disabled) return;
    const stamp = `${c.id}|${connectionName(c)}|${c.model}|${c.key ? 1 : 0}`;
    button.disabled = true; sayTest('Testing…');
    const result = await testConnection(c);
    if (button.isConnected) button.disabled = false;
    const now = cur();
    if (!button.isConnected || !now || `${now.id}|${connectionName(now)}|${now.model}|${now.key ? 1 : 0}` !== stamp) return;
    sayTest(result.text, result.full);
    if (result.ok) markTested(c);
  });

  el.querySelector('#s-name').oninput = e => saveApp('reviewerName', e.target.value);
  el.querySelector('#s-initials').oninput = e => saveApp('reviewerInitials', e.target.value.trim());
  const unpaywallInput = el.querySelector('#s-unpaywall-email');
  if (unpaywallInput) unpaywallInput.disabled = !inDesktop();
  if (unpaywallInput && inDesktop()) {
    unpaywallInput.disabled = true;
    unpaywallEmailNative().then(email => {
      if (!unpaywallInput.isConnected) return;
      unpaywallInput.value = email; unpaywallInput.disabled = false;
    }).catch(error => { unpaywallInput.placeholder = String(error); });
    unpaywallInput.onchange = async () => {
      if (!unpaywallInput.reportValidity()) return;
      try { await setUnpaywallEmailNative(unpaywallInput.value.trim()); unpaywallInput.setCustomValidity(''); }
      catch (error) { unpaywallInput.setCustomValidity(String(error)); unpaywallInput.reportValidity(); }
    };
    unpaywallInput.oninput = () => unpaywallInput.setCustomValidity('');
  }
  // Browser: the choice is kept on this computer; clearing signs out of every site opened in the Lykos browser.
  const browserLinks = el.querySelector('#browser-links');
  if (browserLinks) {
    browserLinks.onchange = () => setOpenLinksInApp(browserLinks.checked);
    browserStateNative().then(state => {
      if (state?.available !== false || !browserLinks.isConnected) return;
      browserLinks.checked = false; browserLinks.disabled = true; el.querySelector('#browser-clear')?.setAttribute('disabled', '');
      el.querySelector('#browser-links-note').textContent = 'Needs macOS 14 or later. Links open in the system browser.';
    }).catch(() => {});
    el.querySelector('#browser-clear')?.addEventListener('click', async () => {
      const note = el.querySelector('#browser-clear-note');
      if (!await confirmAsk('Clear browsing data?', { detail: 'Signs you out of every site opened in the Lykos browser. Pages opened in the system browser are not affected.', confirm: 'Clear', danger: true })) return;
      try { await browserClearDataNative(); if (note?.isConnected) note.textContent = 'Cleared'; }
      catch (error) { if (note?.isConnected) note.textContent = String(error?.message || error).slice(0, 120); }
    });
  }
  el.querySelector('#s-email').oninput = e => saveApp('ncbiEmail', e.target.value.trim());
  // SCImago's rankings: the file a person downloads, kept on this computer, never shipped (lib/sjr.mjs)
  const sjrState = el.querySelector('#s-sjr-state');
  if (sjrState) import('../lib/sjr.mjs').then(m => m.loadSjr().then(t => { if (sjrState.isConnected) sjrState.textContent = t ? `${plural(t.count, 'journal')} from ${m.SJR_SOURCE}${t.year ? `, ${t.year}` : ''}` : 'Not imported. Download a year from scimagojr.com: Journal Rankings, Download data'; }));
  el.querySelector('#s-sjr-import')?.addEventListener('click', async () => {
    const m = await import('../lib/sjr.mjs'), file = await m.pickSjrFile(); if (!file) return;
    try { const t = m.parseSjrCsv(await file.text(), file.name); await m.saveSjr(t); ctx.rerender(`Imported ${plural(t.rows.length, 'journal')} from ${m.SJR_SOURCE}${t.year ? `, ${t.year}` : ''}`); }
    catch (err) { ctx.rerender(String(err?.message || err)); }
  });
  el.querySelector('#s-sjr-remove')?.addEventListener('click', async () => { await (await import('../lib/sjr.mjs')).removeSjr(); ctx.rerender('SCImago journal ranks removed'); });
  el.querySelector('#s-key').onchange = e => { const key = e.target.value.trim(); e.target.value = ''; if (key) { saveApp('ncbiKey', key); ctx.rerender(); } };
  el.querySelector('[data-key-clear="s-key"]')?.addEventListener('click', () => { saveApp('ncbiKey', ''); ctx.rerender(); });
  // a key changes the OpenAlex allowance, so a day recorded as spent is forgotten
  // A browser tab cannot reach TinyFish or Brave (lib/external-web.mjs), so those two rows are not drawn there.
  el.querySelector('#s-bravekey')?.addEventListener('change', e => { const key = e.target.value.trim(); e.target.value = ''; if (key) { saveApp('braveKey', key); ctx.rerender(); } });
  el.querySelector('#s-tinyfishkey')?.addEventListener('change', e => { const key = e.target.value.trim(); e.target.value = ''; if (key) { saveApp('tinyfishKey', key); ctx.rerender(); } });
  el.querySelector('[data-key-clear="s-tinyfishkey"]')?.addEventListener('click', () => { saveApp('tinyfishKey', ''); ctx.rerender(); });
  el.querySelector('[data-key-clear="s-bravekey"]')?.addEventListener('click', () => { saveApp('braveKey', ''); ctx.rerender(); });
  el.querySelector('#s-oakey').onchange = e => { const key = e.target.value.trim(); e.target.value = ''; if (key) { saveApp('openalexKey', key); openalexKeyChanged(); ctx.rerender(); } };
  el.querySelector('[data-key-clear="s-oakey"]')?.addEventListener('click', () => { saveApp('openalexKey', ''); openalexKeyChanged(); ctx.rerender(); });
  const drawFolders = async () => {
    const host = el.querySelector('#s-folders'); if (!host) return;
    const rs = await roots().catch(() => []);
    host.innerHTML = rs.map((r, i) => srow(r.label, { desc: r.path, line: true, find: r.path, overflow: [{ id: `folder-forget-${i}`, label: 'Forget folder', danger: true, attrs: { 'data-forget': r.path } }] })).join('')
      || srow('Folders', { readout: true, desc: 'None added' });
    host.querySelectorAll('[data-forget]').forEach(b => b.onclick = async () => { await forgetFolder(b.dataset.forget); drawFolders(); });
  };
  drawFolders();
  el.querySelector('#s-folder-add')?.addEventListener('click', async () => { await addFolder(); drawFolders(); });
  el.querySelector('#s-dual').onchange = e => save('dualScreening', Boolean(e.target.value));
  el.querySelector('#s-retract-days')?.addEventListener('change', e => save('retractionFreshDays', Number(e.target.value)));   // lib/integrity.mjs freshDays
  el.querySelector('#s-screen-second').onchange = e => save('screenSecond', e.target.value);
  el.querySelector('#s-initials2').onchange = e => { pinScalar('reviewerInitials', e.target.value); ctx.rerender(); };
  el.querySelector('#s-measure').onchange = e => save('measure', e.target.value);
  el.querySelector('#s-method').onchange = e => save('method', e.target.value);
  // A style chosen here is the author's and outlasts a change of journal; "From <journal>" hands the choice back (lib/journal-context.mjs).
  el.querySelector('#s-refstyle').onchange = e => {
    const style = e.target.value, byHand = style !== 'auto';
    save('refStyleManual', byHand);
    save('refStyle', byHand ? style : '');
    save('citationStyle', byHand ? (STYLES.find(x => x.id === style)?.numbered ? 'numbered' : 'author-year') : '');
    save('journalPreset', ''); save('journalPresetName', '');
    ctx.rerender();
  };
  el.querySelectorAll('[data-sc-int]').forEach(x => x.onchange = () => { setScheduleInterval(x.dataset.scInt, x.value); ctx.rerender(); });
  el.querySelectorAll('[data-sc-on]').forEach(x => x.onchange = () => { toggleSchedule(x.dataset.scOn, x.checked); ctx.rerender(); });
  el.querySelectorAll('[data-sc-more]').forEach(x => x.onclick = () => showMenu(x, [
    { label: 'Remove schedule', icon: 'trash', danger: true, run: () => { removeSchedule(x.dataset.scMore); ctx.rerender(); } }], { align: 'end' }));
  el.querySelectorAll('[data-sc-run]').forEach(x => x.onclick = async () => {
    x.disabled = true;
    try { await runSchedule(x.dataset.scRun, { settings: settings() }); } catch (err) { console.warn(err); }
    ctx.rerender(); ctx.refreshCounts();
  });

  el.querySelector('#export').onclick = async () => {
    // Without this machine's API keys: a project file is shared, credentials are not. Its figures are written in.
    const blob = new Blob([JSON.stringify(await exportableWithFigures(), null, 2)], { type: 'application/json' });
    saveFile(blob, `lykos-project-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  // Whole-project backup and restore (lib/project-backup.mjs); a restore is a new project, never this one.
  el.querySelector('#backup-project')?.addEventListener('click', async e => {
    const b = e.currentTarget, out = el.querySelector('#pstatus');
    b.disabled = true; out.textContent = 'Backing up…';
    try { out.textContent = backupReport(await backupOpenProject()); } catch (err) { out.textContent = `Not backed up: ${err.message}`; }
    b.disabled = false;
  });
  el.querySelector('#restore-backup')?.addEventListener('click', () => restoreFlow(msg => { const out = el.querySelector('#pstatus'); if (out) out.textContent = msg; }));
  if (el.querySelector('.pm')) wireProjects(el, ctx);
  wireStorage(el, section === 'storage' && !el.querySelector('section[data-sec="storage"]')?.hidden);
  if (section === 'about') {
    appIdentity().then(id => { const v = el.querySelector('#about-version'); if (v) v.textContent = versionLabel(id) || 'Development build'; });
    renderNotices(el.querySelector('#about-sections'));
    // the update row follows the updater while the section is open (lib/app-update.mjs)
    const showUpdate = st => {
      const d = el.querySelector('#about-update'), check = el.querySelector('#update-check'), restart = el.querySelector('#update-restart');
      if (!d?.isConnected) return stopUpdate?.();
      d.textContent = updateText(st);
      if (check) { check.hidden = st.phase === 'ready'; check.disabled = ['checking', 'downloading'].includes(st.phase) || st.phase === 'unavailable'; }
      if (restart) restart.hidden = st.phase !== 'ready';
    };
    stopUpdate?.(); stopUpdate = onUpdateState(showUpdate); showUpdate(updateState());
    el.querySelector('#update-check')?.addEventListener('click', () => checkForUpdate());
    el.querySelector('#update-restart')?.addEventListener('click', () => restartToUpdate().catch(err => { const d = el.querySelector('#about-update'); if (d) d.textContent = `Not restarted: ${err?.message || err}`; }));
  }
  // Figures no project, recovery copy or backup names any more (store.mjs figureCleanup).
  // Both rows read every stored project, so they are worked out only while
  // their section is open, and once per version of the project: Settings keeps
  // every section in the page for its search, and redraws on each change.
  const openHost = id => { const host = el.querySelector(id); return host && !host.closest("section[hidden]") ? host : null; };
  const figureRow = async () => {
    const out = openHost('#figure-status'); if (!out) return;
    const clean = el.querySelector('#figure-clean');
    const mb = n => `${(n / 1048576).toFixed(1)} MB`;
    const v = getVersion();
    if (figurePlan.version !== v) figurePlan = { version: v, plan: figureCleanup().catch(err => ({ available: false, reason: err.message })) };
    const plan = await figurePlan.plan;
    if (!out.isConnected) return;
    if (!plan.available) { out.textContent = plan.reason || '—'; return; }
    out.textContent = `${plan.total} stored · ${plan.count ? `${plan.count} unused, ${mb(plan.bytes)}` : 'none unused'}`;
    clean.disabled = !plan.count;
    clean.onclick = async () => {
      clean.disabled = true;
      const done = await figureCleanup({ apply: true }).catch(err => ({ available: false, reason: err.message }));
      figurePlan = { version: -1, plan: null };
      out.textContent = done.available ? `Removed ${done.removed} · ${mb(done.freed)}${done.failed.length ? ` · ${done.failed.length} could not be removed` : ''}` : done.reason;
    };
  };
  figureRow();
  if (openHost('#recovery-list')) (recoveryCache.version === getVersion() ? recoveryCache.list : (recoveryCache = { version: getVersion(), list: listRecoveries() }).list).then(copies => {
    const host = el.querySelector('#recovery-list'); if (!host) return;
    // The stored size once every copy is compressed (an older plain copy has none recorded until the session's compaction).
    const packedBytes = copies.every(c => c.bytes) ? copies.reduce((n, c) => n + c.bytes, 0) : 0;
    el.querySelector('#recovery-count').textContent = copies.length ? [plural(copies.length, 'copy', 'copies'), packedBytes ? formatBytes(packedBytes) : ''].filter(Boolean).join(' · ') : 'None';
    const shown = pageOf(copies, recoveryPage, RECOVERY_PAGE); recoveryPage = shown.page;
    const first = (shown.page - 1) * RECOVERY_PAGE;
    host.innerHTML = copies.length ? uiList({ id: 'recovery-copies', label: 'Recovery copies', rows: shown.items.map((c, n) => { const i = first + n; return uiRow({
      attrs: { 'data-find': 'recovery copies' }, main: { html: esc(when(c.at)), detail: [esc(plural(c.papers, 'record')), esc(plural(c.values, 'value'))] },
      end: uiRowEnd({ primary: { id: `recovery-restore-${i}`, label: 'Restore', attrs: { 'data-recovery-restore': i } }, more: { label: `More for the copy of ${when(c.at)}`, attrs: { 'data-recovery-more': i } } }) }); }) }) + pager({ id: 'recovery-pager', page: shown.page, pages: shown.pages, total: copies.length, label: 'copies', size: RECOVERY_PAGE }) : '';
    wirePager(host, 'recovery-pager', n => { recoveryPage = n; ctx.rerender(); });
    host.querySelectorAll('[data-recovery-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Export', icon: 'export', run: async () => {
      try {
        const copy = await readRecovery(copies[Number(b.dataset.recoveryMore)].key);
        await saveFile(new Blob([JSON.stringify(await exportableWithFigures(copy), null, 2)], { type: 'application/json' }),
          `lykos-recovery-${new Date(copy.savedAt || Date.now()).toISOString().slice(0, 10)}.json`, 'application/json');
      } catch (err) { el.querySelector('#pstatus').textContent = err.message; }
    } }], { align: 'end' }));
    host.querySelectorAll('[data-recovery-restore]').forEach(b => b.onclick = async () => {
      if (!await confirmAsk('Restore this project copy?', { confirm: 'Restore' })) return;
      try { await restoreRecovery(copies[Number(b.dataset.recoveryRestore)].key); ctx.rerender(); ctx.refreshCounts(); }
      catch (err) { el.querySelector('#pstatus').textContent = err.message; }
    });
    ctx.refreshCounts();
  }).catch(err => { const host = el.querySelector('#recovery-list'); if (host) host.textContent = err.message; });
  el.querySelector('#import').onclick = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json';
    i.hidden = true; document.body.append(i);
    i.addEventListener('cancel', () => i.remove(), { once: true });
    i.onchange = async () => {
      if (!i.files[0]) return;
      try {
        let data;
        try { data = JSON.parse(await i.files[0].text()); } catch { throw new Error('the file is not JSON'); }
        if (!Array.isArray(data?.papers)) throw new Error('not a Lykos project file');
        if (!await confirmAsk('Replace this project with the imported file?', { detail: `${data.papers.length} records. The current project is kept as a recovery copy.`, confirm: 'Import' })) return;
        // Validated, migrated, this machine's keys kept, the current project kept as a recovery copy.
        await replaceProject(data, { source: 'The file' });
        ctx.rerender(); ctx.refreshCounts();
        el.querySelector('#pstatus').textContent = `Imported ${data.papers.length} records.`;
      } catch (err) {
        el.querySelector('#pstatus').textContent = `Could not import: ${err.message}`;
      } finally { i.remove(); }
    };
    i.click();
  };
  el.querySelector('#reset').onclick = async () => {
    if (!await confirmAsk('Reset this project?', { detail: 'Removes every record and decision. The project is kept as a recovery copy.', confirm: 'Reset', danger: true })) return;
    // The project keeps its name, type and journal; everything else starts over, recoverable.
    replaceProject({ papers: [], project: get().project, paper: get().paper, settings: get().settings }, { source: 'Reset' })
      .then(() => { ctx.rerender(); ctx.refreshCounts(); })
      .catch(err => { el.querySelector('#pstatus').textContent = err.message; });
  };
}

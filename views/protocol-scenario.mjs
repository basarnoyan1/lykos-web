// The protocol page's criteria part when a scenario is picked (protocol scenarios, spec "Interface", plan Task 4): main's criteria with what
// the scenario removes, rewords or adds marked on each line (a rule and the word, no hue), how many of main's exclusions cite each, what the
// scenario asks again, and the searches it keeps. Every edit is the scenario's diff (lib/scenarios.mjs editScenario); main's protocol,
// searches and decisions are never written here, but for "Add to main protocol", which makes a scenario's own run main's (assignRun).
// Every write is one action of lib/scenario-actions.mjs, applied as the change-file ops lykos-apply and the MCP apply (scenarioAct).
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$day as day } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd, lib_ui_actions$uiSummary as uiSummary } from "../boot.mjs";
import { lib_ui_components$disclosure as disclosure, lib_ui_components$formField as formField } from "../boot.mjs";
import { lib_dialog$formDialog as formDialog, lib_dialog$ask as ask, lib_dialog$askText as askText, lib_dialog$confirmAsk as confirmAsk } from "../boot.mjs";
import { runsOf } from '../lib/reviews.mjs';
import { runName } from '../lib/prisma-counts.mjs';
import { scenarioOf, keptRuns, runId, recordRuns } from '../lib/scenario-runs.mjs';
import { criterionCitations, reaskReasons } from '../lib/scenarios.mjs';
import { scenarioOps } from '../lib/scenario-actions.mjs';
import { CHANGE_FILE_OPS } from '../lib/change-file.mjs';
import { pickScenario } from '../lib/scenario-pick.mjs';
import { sectionHead } from './protocol-parts.mjs';
import { lib_rules_key$stageName as stageName } from "../boot.mjs";

const list = v => Array.isArray(v) ? v : [];
const KIND = { include: 'Include', exclude: 'Exclude', group: 'Group' };
let searchesOpen = false;   // the Searches disclosure, open across redraws

/**
 * One scenario action (lib/scenario-actions.mjs SCENARIO_ACTIONS: create, rename, delete, criterion, search, promote) applied to the store
 * as its change-file ops, as tools/lykos-scenarios.mjs and the MCP apply them; answers what the last op said.
 */
export function scenarioAct(action, a) {
  let said = '';
  update(st => { for (const c of scenarioOps(st, action, a)) said = CHANGE_FILE_OPS[c.op].does(st, c); return st; });
  return said;
}

// ---- the scenario itself ------------------------------------------------------------------------------------------------------------------

/** Makes a scenario of the main protocol and picks it for this window; answers its id. */
export function createScenario({ name, reason = '' }) {
  const had = new Set(list(get().protocol?.scenarios).map(x => String(x?.id)));
  scenarioAct('create', { name, reason });
  const id = String(list(get().protocol?.scenarios).find(x => !had.has(String(x?.id)))?.id || '');
  pickScenario(id);
  return id;
}
export const renameScenario = (id, name) => scenarioAct('rename', { id, name });
/** Removes a scenario and its overlay; the window shows the main protocol. Answers what stays (removeScenario: its runs and records). */
export function deleteScenario(id) {
  const s = get(), sc = scenarioOf(s, id), names = new Map(list(s.scenarioSearches).map(r => [runId(r, s), r.name || runName(r)]));
  // what removeScenario keeps: the runs imported for it and the records only they found
  const runs = list(s.scenarioSearches).filter(r => r?.scenario === sc.id).map(r => runId(r, s)), rids = new Set(runs), byRec = recordRuns(s);
  const kept = { runs, records: list(s.scenarioPapers).filter(p => [...(byRec.get(p?.id) || [])].some(r => rids.has(r))).map(p => p.id) };
  scenarioAct('delete', { id });
  pickScenario('main');
  return { ...kept, message: deletedMessage(sc.name || sc.id, kept.runs.map(r => names.get(r) || r), kept.records.length) };
}
/** What a deleted scenario leaves (spec Settled 8: its runs and records stay, in no protocol, and are listed). */
export function deletedMessage(name, runs, records) {
  if (!runs.length && !records) return `${name} deleted`;
  const what = [runs.length ? runs.join(', ') : '', records ? plural(records, 'record') : ''].filter(Boolean).join(' and ');
  return `${name} deleted. ${what} stay in the project, in no protocol`;
}

/** The New scenario dialog: Name and Reason; resolves to the new id, or null. */
export async function newScenarioDialog() {
  const v = await formDialog({ id: 'scenario-new', title: 'New scenario', tier: 'S', confirm: 'Create',
    body: formField('Name', '<input name="name" autocomplete="off" spellcheck="false" required>') + formField('Reason', '<textarea name="reason" rows="2"></textarea>'),
    submit: form => { const name = form.elements.name; if (!name.value.trim()) { name.setCustomValidity('Enter a name.'); name.reportValidity(); return undefined; } return { name: name.value.trim(), reason: form.elements.reason.value.trim() }; } });
  return v ? createScenario(v) : null;
}
export async function renameDialog(id) {
  const name = await ask('Rename scenario', { value: scenarioOf(get(), id).name, confirm: 'Rename' });
  if (name?.trim()) renameScenario(id, name.trim());
  return !!name?.trim();
}
/** Asks, deletes, and answers the message that says what stays (the page shows it), or null when not confirmed. */
export async function deleteDialog(id) {
  const s = get(), sc = scenarioOf(s, id), lane = s.scenarioScreening?.[sc.id] || {};
  const own = Object.keys(lane.ta || {}).length + Object.keys(lane.ft || {}).length;
  const detail = `${sc.name}: ${own ? `its ${plural(own, 'decision')} are deleted; ` : ''}its searches and records stay`;
  if (!await confirmAsk('Delete scenario?', { detail, confirm: 'Delete', danger: true })) return null;
  return deleteScenario(id).message;
}

// ---- criteria -------------------------------------------------------------------------------------------------------------------------

/** The scenario's lines: main's criteria (each marked removed or changed), those it adds, and its references to criteria main no longer has. */
function criteriaLines(s, sc) {
  const main = list(s.protocol?.criteria).filter(c => c?.id != null), ids = new Set(main.map(c => String(c.id)));
  const removed = new Set(sc.criteria.remove.map(String)), change = sc.criteria.change;
  const lines = main.map(c => {
    const id = String(c.id);
    if (removed.has(id)) return { c, id, mark: 'removed', text: c.text };
    if (id in change) return { c, id, mark: 'changed', text: String(change[id]) };
    return { c, id, mark: '', text: c.text };
  });
  for (const c of sc.criteria.add) if (c?.id != null) lines.push({ c, id: String(c.id), mark: 'added', text: c.text });
  const gone = [...new Set([...removed, ...Object.keys(change)])].filter(id => !ids.has(id));
  for (const id of gone) lines.push({ c: { id }, id, mark: 'gone', text: '' });
  return lines;
}

const MARK = { removed: 'Removed', changed: 'Changed', added: 'Added', gone: 'No longer in the main protocol' };

function criterionRow(line, cites) {
  const { c, id, mark, text } = line;
  const body = mark === 'removed' ? `<s>${esc(text)}</s>` : esc(text || '');
  const n = cites.get(id);
  return uiRow({ cls: 'scn-crit', attrs: { 'data-scn-crit': id, ...(mark ? { 'data-scn-mark': mark } : {}) },
    main: { html: `<span class="scn-crit-text"><span class="scn-crit-id">${esc(id)}</span> ${body}</span>`, wrap: true,
      detail: mark === 'gone' ? [MARK.gone] : [KIND[c.kind] || 'Include', stageName(c), mark ? MARK[mark] : ''] },
    cells: [{ col: 'cites', kind: 'text', ch: 20, html: n == null ? '' : `Cited by ${plural(n, 'exclusion')}` }],
    end: uiRowEnd({ more: { label: `More for ${id}`, attrs: { 'data-scn-crit-more': id } } }) });
}

/**
 * The menu of a criterion's line: Edit text, Restore (main's line as it is) and Remove for main's; Edit text and Remove for one the
 * scenario adds; Remove from scenario for a reference to a criterion main no longer has. `done` runs after the change.
 */
export function criterionMenu(s, scenarioId, cid, done = () => {}) {
  const sc = scenarioOf(s, scenarioId), line = criteriaLines(s, sc).find(l => l.id === String(cid));
  if (!line) return [];
  const after = (how, extra = {}) => () => { scenarioAct('criterion', { id: scenarioId, how, criterion: String(cid), ...extra }); done(); };
  const restore = { label: 'Restore', icon: 'restore', run: after('restore') };
  if (line.mark === 'gone') return [{ label: 'Remove from scenario', icon: 'trash', run: restore.run }];
  if (line.mark === 'removed') return [restore];
  const editText = { label: 'Edit text', icon: 'criteria-edit', run: async () => {
    const t = await askText(`Edit ${cid}`, { value: line.text, confirm: 'Save' });
    if (t == null || !t.trim()) return;
    after('reword', { text: t.trim() })();
  } };
  const remove = { label: 'Remove', icon: 'trash', run: after('remove') };
  if (line.mark === 'added') return [editText, '-', remove];
  return [editText, ...(line.mark === 'changed' ? [restore] : []), '-', remove];
}

/** The Add criterion dialog: the criterion joins the scenario's own (`S1`, `S2`, …, no id main or the scenario has). */
async function addCriterionDialog(scenarioId) {
  const sel = (name, options) => `<select name="${name}">${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  const v = await formDialog({ id: 'scenario-criterion', title: 'Add criterion', tier: 'S', confirm: 'Add',
    body: formField('Criterion', '<textarea name="text" rows="2"></textarea>') + formField('Kind', sel('kind', [['exclude', 'Exclude'], ['include', 'Include']]))
      + formField('Applies at', sel('stage', [['Title/abstract', 'Title/abstract'], ['Full text', 'Full text']])),
    submit: form => { const t = form.elements.text; if (!t.value.trim()) { t.setCustomValidity('Enter the criterion.'); t.reportValidity(); return undefined; }
      return { text: t.value.trim(), kind: form.elements.kind.value, stage: form.elements.stage.value }; } });
  if (!v) return false;
  scenarioAct('criterion', { id: scenarioId, how: 'add', ...v });   // the first S1, S2, … neither main nor the scenario uses
  return true;
}

/** The summary line: what the scenario asks again, and why. */
export function reaskText(s, scenarioId) {
  const r = reaskReasons(s, scenarioId), parts = [];
  for (const [code, n] of r.codes) parts.push(parts.length ? `${n} citing ${code}` : `${plural(n, 'exclusion')} citing ${code}`);
  if (r.uncited) parts.push(parts.length ? `${r.uncited} with no criterion cited` : `${plural(r.uncited, 'exclusion')} with no criterion cited`);
  if (r.added) parts.push(`${plural(r.added, 'included or uncertain record')} under added criteria`);
  if (r.reworded) parts.push(`${plural(r.reworded, 'included or uncertain record')} under a reworded criterion`);
  if (r.new) parts.push(`${plural(r.new, 'record')} new to this scenario`);
  if (r.stale) parts.push(`${plural(r.stale, 'scenario decision')} out of date`);
  if (!parts.length) return 'Re-asks no main decision';
  return `Re-asks ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`;
}

// ---- searches -------------------------------------------------------------------------------------------------------------------------

/** The runs a scenario may keep: its review's (not failed, not exploratory), its own, and any other its `add` names; [{ r, id, own, kept }]. */
function runLines(s, sc) {
  const kept = keptRuns(s, sc.id), add = new Set(sc.searches.add), out = [], seen = new Set();
  const push = (r, own) => { const id = runId(r, s); if (seen.has(id)) return; seen.add(id); out.push({ r, id, own, kept: kept.has(id) }); };
  for (const { r } of runsOf(s, sc.review)) if (r && r.status !== 'failed' && !r.exploratory && !r.scenario) push(r, false);
  for (const r of list(s.scenarioSearches)) if (r && (r.scenario === sc.id || add.has(runId(r, s)))) push(r, true);
  return out;
}

function runRow({ r, id, own, kept }) {
  const name = r.name || runName(r);
  const found = r.retrieved ?? r.total;
  return uiRow({ cls: 'scn-run', attrs: { 'data-scn-run-row': id },
    check: { checked: kept, label: `Keep ${name}`, attrs: { 'data-scn-run': id } },
    main: { html: esc(name), detail: [r.date || r.at ? day(r.date || r.at) : '', found != null ? plural(Number(found) || 0, 'record') : '', own ? 'This scenario only' : ''] },
    end: own ? uiRowEnd({ more: { label: `More for ${name}`, attrs: { 'data-scn-run-more': id } } }) : uiRowEnd({ reserve: true }) });
}

/** The menu of a scenario's own run: Add to main protocol (assignRun: the run and the records it found become main's). */
export function runMenu(s, scenarioId, rid, done = () => {}) {
  const line = runLines(s, scenarioOf(s, scenarioId)).find(l => l.id === rid);
  if (!line?.own) return [];
  const name = line.r.name || runName(line.r), n = list(s.scenarioPapers).filter(p => recordRuns(s).get(p?.id)?.has(rid)).length;
  return [{ label: 'Add to main protocol', icon: 'library-add', run: async () => {
    if (!await confirmAsk('Add to main protocol?', { detail: `${name}: ${plural(n, 'record')} join the main protocol`, confirm: 'Add' })) return;
    scenarioAct('promote', { run: rid }); done();
  } }];
}

/** Ticks a run in or out of the scenario: a main run by `searches.remove`, one of its own by `searches.add`. */
function keepRun(s, scenarioId, rid, on) {
  const line = runLines(s, scenarioOf(s, scenarioId)).find(l => l.id === rid);
  if (!line) return;
  scenarioAct('search', { id: scenarioId, run: rid, keep: on });
}

// ---- the part -------------------------------------------------------------------------------------------------------------------------

/** The criteria part with a scenario picked: its head, the summary line, the criteria and the Searches disclosure. */
export function scenarioCriteriaPanel(part, s, scenarioId) {
  const sc = scenarioOf(s, scenarioId), lines = criteriaLines(s, sc), cites = criterionCitations(s);
  const shown = lines.filter(l => l.mark !== 'removed' && l.mark !== 'gone').length;
  const runs = runLines(s, sc);
  return `<div class="panel">
      ${sectionHead({ id: 'scn-criteria-head', label: 'Eligibility criteria', title: part ? '' : 'Eligibility criteria',
        status: { id: 'scn-criteria-count', text: plural(shown, 'criterion', 'criteria'), ch: 12 },
          actions: [{ id: 'scn-add', label: 'Add criterion', icon: 'plus' }, { id: 'scn-import', label: 'Import search', icon: 'import', role: 'secondary' }] })}
      <div class="panel-body tight" id="scn-body">
        ${sc.reason ? `<p class="meta scn-reason">${esc(sc.reason)}</p>` : ''}
        ${uiSummary({ id: 'scn-reask', label: 'Re-asked decisions', text: reaskText(s, scenarioId) })}
        ${uiList({ id: 'scn-criteria', label: `Criteria of ${sc.name || sc.id}`, cols: ['cites'], rows: lines.map(l => criterionRow(l, cites)), empty: emptyState({ title: 'No criteria', size: 'inline' }) })}
        ${disclosure({ id: 'scn-searches', title: 'Searches', count: `${runs.filter(x => x.kept).length} of ${runs.length}`, open: searchesOpen,
          body: uiList({ id: 'scn-runs', label: 'Searches', rows: runs.map(runRow), empty: emptyState({ title: 'No searches logged', size: 'inline' }) }) })}
      </div></div>`;
}

/** Wires the part drawn by scenarioCriteriaPanel; `redraw` draws the page again after a change. */
export function wireScenarioCriteria(el, scenarioId, redraw) {
  el.querySelector('#scn-add')?.addEventListener('click', async () => { if (await addCriterionDialog(scenarioId)) redraw(); });
  // a search exported for this scenario: read as the Library reads one, its run and new records the scenario's (lib/search-import.mjs importInto)
  el.querySelector('#scn-import')?.addEventListener('click', async () => {
    const lib = await import('./library.mjs');
    lib.pick({ accept: lib.IMPORT_ACCEPT }, async files => { let said = ''; await lib.importRecords(files[0], m => { said = m; }, { scenario: scenarioId }); searchesOpen = true; redraw(said); });
  });
  el.querySelectorAll('[data-scn-crit-more]').forEach(b => { b.onclick = () => showMenu(b, criterionMenu(get(), scenarioId, b.getAttribute('data-scn-crit-more'), redraw), { align: 'end' }); });
  el.querySelectorAll('[data-scn-run-more]').forEach(b => { b.onclick = () => showMenu(b, runMenu(get(), scenarioId, b.getAttribute('data-scn-run-more'), redraw), { align: 'end' }); });
  el.querySelectorAll('input[data-scn-run]').forEach(box => { box.onchange = () => { keepRun(get(), scenarioId, box.getAttribute('data-scn-run'), box.checked); redraw(); }; });
  const d = el.querySelector('#scn-searches');
  if (d) d.ontoggle = () => { searchesOpen = d.open; };
}

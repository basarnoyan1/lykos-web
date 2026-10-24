// Screening › Import reviewer sheet: pick a workbook, say who each reviewer column is, import; what matched, what is new and what
// conflicts is a notice at the top of Screening (lib/screening-sheet.mjs holds every rule; this file is the plan dialog). The mapping is
// remembered for the project, so the next sheet from the same people needs one press.
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { formDialog } from '../lib/dialog.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { isDual } from '../lib/screen.mjs';
import { openXlsx } from '../lib/xlsx-edit.mjs';
import { parseDelimited } from '../lib/spreadsheet.mjs';
import { readReviewerWorkbook, defaultRoles, planReviewerImport, applyReviewerImport, disagreements, namesOf, nameKey as fold, ROLES } from '../lib/screening-sheet.mjs';

const STAGE_NAME = { ta: 'Title and abstract', ft: 'Full text' };

/** The workbook chooser; resolves to the file, or null when the window is dismissed. */
function pickWorkbook() {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.xlsx,.csv,.tsv'; i.hidden = true;
    document.body.append(i);
    i.onchange = () => { const f = i.files?.[0] || null; i.remove(); resolve(f); };
    i.oncancel = () => { i.remove(); resolve(null); };
    i.click();
  });
}

/**
 * The mapping: one row per name in the sheet. Resolves to `{ roles, parsed, replace, enableDual }`, or null.
 * `aKey` is the key Reviewer A's decisions are kept under (the person's initials).
 */
function mappingDialog({ file, candidates, me, aKey }) {
  let parsed = candidates[0];
  let roles = defaultRoles(parsed.columns, get(), me);
  let replace = false, enableDual = true;
  const choose = (attrs, label, options) => `<select ${attrs} aria-label="${esc(label)}">${options}</select>`;
  const row = (id, name, detail, control) => uiRow({ id, main: { html: esc(name), detail: detail ? [detail] : [], wrap: true }, cells: [{ col: 'pick', kind: 'control', html: control }] });
  const mapRows = () => namesOf(parsed.columns).map((n, i) => row(`scr-map-${i}`, n.name, parsed.columns.some(c => c.stage === 'ft') ? [...new Set(parsed.columns.filter(c => fold(c.name) === n.key).map(c => STAGE_NAME[c.stage]))].join(', ') : '',
    choose(`data-scr-role="${esc(n.key)}"`, n.name, ROLES.map(([v, l]) => `<option value="${v}"${roles[n.key] === v ? ' selected' : ''}>${esc(v === 'A' && aKey ? `${l} (${aKey})` : l)}</option>`).join(''))));
  const check = (id, label, on, attr) => uiRow({ id, check: { checked: on, label, attrs: { [attr]: true } }, main: { html: esc(label) } });
  const body = () => `
    ${candidates.length > 1 ? uiList({ id: 'scr-sheet-pick', label: 'Sheet', cols: ['pick'], rows: [row('scr-sheet-row', 'Sheet', '', choose('data-sheet', 'Sheet', candidates.map((c, i) => `<option value="${i}"${c === parsed ? ' selected' : ''}>${esc(c.sheet)}</option>`).join('')))] }) : ''}
    <div data-body-map>${uiList({ id: 'scr-sheet-map', label: 'Reviewer columns', cols: ['pick'], rows: mapRows() })}</div>
    ${uiList({ id: 'scr-sheet-options', label: 'Import options', rows: [...(isDual(get()) ? [] : [check('scr-opt-dual', 'Turn on two reviewers', enableDual, 'data-scr-dual')]), check('scr-opt-replace', 'Replace decisions already recorded', replace, 'data-scr-replace')] })}`;
  // a plan to accept or discard (DIALOGS §3, tier M): the rows, the options and one line of what the import would do
  return formDialog({ id: 'reviewer-sheet', title: 'Import reviewer sheet', detail: `${file.name}, ${plural(parsed.rows.length, 'record')}`, confirm: 'Import',
    body: `<div class="ask-scroll"><div data-body>${body()}</div></div><p class="meta" data-sheet-line role="status"></p>`,
    submit: (form, d) => (d.querySelector('[type=submit]').disabled ? undefined : { roles, parsed, replace, enableDual }),
    onMount: d => {
    const ok = d.querySelector('[type=submit]'), msg = d.querySelector('[data-sheet-line]');
    const refresh = () => {
      const plan = planReviewerImport(get(), parsed, roles, { aKey, replace });
      ok.disabled = plan.problems.length > 0;
      msg.textContent = plan.problems[0] || [plural(plan.matched, 'record') + ' matched', `${plan.fresh.length} new`, plan.conflicts.length ? `${plan.conflicts.length} differ` : ''].filter(Boolean).join(', ');
    };
    const wire = () => {
      d.querySelectorAll('[data-scr-role]').forEach(s => s.onchange = () => { roles = { ...roles, [s.dataset.scrRole]: s.value }; refresh(); });
      const sheet = d.querySelector('[data-sheet]');
      if (sheet) sheet.onchange = () => { parsed = candidates[Number(sheet.value)]; roles = defaultRoles(parsed.columns, get(), me); d.querySelector('[data-body]').innerHTML = body(); wire(); refresh(); };
      const dual = d.querySelector('[data-scr-dual]'); if (dual) dual.onchange = () => { enableDual = dual.checked; };
      d.querySelector('[data-scr-replace]').onchange = e => { replace = e.target.checked; refresh(); };
    };
    wire(); refresh();
  } });
}

/** The import's result in words, for the notice at the top of Screening: the three counts, then what else happened. */
function resultSummary({ file, plan, disagree }) {
  const n = disagree.length + plan.conflicts.length;
  const written = plan.writes.filter(w => w.kind === 'person').length, proposals = plan.writes.filter(w => w.kind === 'model').length;
  const facts = [written ? `${plural(written, 'decision')} written` : '', plan.unchanged ? `${plural(plan.unchanged, 'decision')} already recorded` : '', proposals ? `${plural(proposals, 'model proposal')}` : '',
    plan.modelKept ? `${plural(plan.modelKept, 'proposal')} kept from a live model` : '', plan.conflicts.length ? `${plural(plan.conflicts.length, 'value')} kept as recorded` : '',
    plan.duplicates ? `${plural(plan.duplicates, 'duplicate row')} skipped` : '', plan.unread ? `${plural(plan.unread, 'cell')} not read` : '', isDual(get()) ? '' : 'Two reviewers is off'].filter(Boolean);
  return { file, conflicts: disagree.length, text: [`Imported ${file}: ${plural(plan.matched, 'record')} matched`, `${plan.fresh.length} new`, plural(n, 'conflict'), ...facts].join(', ') };
}

/**
 * The whole flow. `me`: { key, names } (the person's initials and names, for the defaults); `done()` repaints; `say(text)` puts why
 * nothing was imported on the page. Resolves to the result for Screening's notice (`{ file, conflicts, text }`), or null.
 */
export async function importReviewerSheet({ me, done = () => {}, say = () => {} }) {
  const file = await pickWorkbook();
  if (!file) return null;
  let wb;
  // A CSV or TSV (a decision index kept beside the papers) is one sheet with no fills: its decisions are read from the words alone.
  try { wb = /\.(csv|tsv)$/i.test(file.name) ? { sheets: [{ name: file.name, rows: parseDelimited(await file.text(), /\.tsv$/i.test(file.name) ? '\t' : ',').rows }] } : await openXlsx(new Uint8Array(await file.arrayBuffer())); }
  catch (err) { say(`Not imported: ${String(err?.message || err).slice(0, 160)}`); return null; }
  const { candidates } = readReviewerWorkbook(wb.sheets);
  if (!candidates.length) { say('Not imported: the sheet needs columns such as Decision (Color)-Name, with a Title or DOI column'); return null; }
  const aKey = String(me.key || '').trim();
  const choice = await mappingDialog({ file, candidates, me, aKey });
  if (!choice) return null;
  const plan = planReviewerImport(get(), choice.parsed, choice.roles, { aKey, replace: choice.replace });
  let applied;
  try { applied = applyReviewerImport(plan, { roles: choice.roles, columns: choice.parsed.columns, aKey, enableDual: choice.enableDual, file: file.name }); }
  catch (err) { say(`Not imported: ${String(err?.message || err).slice(0, 160)}`); return null; }
  done();
  return resultSummary({ file: file.name, plan, disagree: disagreements(get(), applied.touched) });
}

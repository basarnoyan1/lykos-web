// Runs: the log of a fill or verify run (its steps, its usage, the earlier runs and batches of a table) for the inspector's Run
// section. Import: a workbook becomes a template and its rows become proposals awaiting evidence.
import { get, update } from '../store.mjs';
import { shortModel } from '../lib/ai.mjs';
import { readXlsx } from '../lib/xlsx-read.mjs';
import { templateFromWorkbook, matchRows } from '../lib/template-import.mjs';
import { saveTemplate, newTemplateId, columnsOf, templateById } from '../lib/templates.mjs';
import { parseDelimited } from '../lib/bib.mjs';
import { decodeImport } from '../lib/import-safety.mjs';
import { inferType } from '../lib/datasets.mjs';
import { TYPES } from '../lib/fields.mjs';
import { propose } from '../lib/proposals.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { evidenceAdoption, refOf } from '../lib/drift.mjs';
import { locateInFolder, recordImport, untrackedNote } from '../lib/adoption.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { ago, plural } from '../lib/dates.mjs';
import { planDialog } from '../lib/dialog.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { disclosure, uiLink } from '../lib/ui-components.mjs';
import { batchRuns, recordLine } from '../lib/batch-report.mjs';
import { focusRow, focusReport } from './patient-review.mjs';

const k = n => n == null ? '' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// A step of a run is a row: its name, what it asked and returned beneath it (words wrap at word breaks), its tokens in a fixed cell.
// An error is heavier, not coloured. A list of rows holds the log, so the log is as readable at 360 as at 1440.
const logRow = ({ name, nameHtml = '', detail = [], cell = '', error = false, cellCh = 6 }) => uiRow({ cls: `run-row${error ? ' error' : ''}`,
  main: { html: `<span class="run-row-name">${nameHtml || esc(name)}</span>`, detail: detail.filter(Boolean).map(esc), wrap: true },
  cells: [{ col: 'cell', kind: 'text', ch: cellCh, html: esc(cell) }] });
export const stepLine = s => logRow({ name: s.name, detail: [`${s.args ? `${s.args.slice(0, 80)} → ` : ''}${s.result ?? ''}`], cell: s.tokens ? k(s.tokens) : '', error: s.type === 'error' });
const logList = (id, label, rows) => uiList({ id, label, cols: ['cell'], empty: emptyState({ title: 'Nothing yet', size: 'inline' }), rows });
const usageLine = u => u ? [u.prompt != null ? `${k(u.prompt)} in` : '', u.completion != null ? `${k(u.completion)} out` : '', u.cost != null ? `$${u.cost.toFixed(4)}` : 'cost unknown'].filter(Boolean).join(', ') : '';
const tokenCell = u => u ? [u.prompt != null ? `${k(u.prompt)} in` : '', u.completion != null ? `${k(u.completion)} out` : ''].filter(Boolean).join(', ') : '';
const costText = u => u ? (u.cost != null ? `$${u.cost.toFixed(4)}` : 'cost unknown') : '';

// ---- numeric gate (numeric-gate.mjs): findings per proposal, possible missed values per run
const findingsOf = r => Object.values(get().proposals || {}).filter(p => p.run_id === r.id && p.findings?.length);
const columnLabel = (r, id) => (get().templates || []).flatMap(t => t.columns || []).find(c => c.id === id)?.label || String(id).split('.').pop();
export function gateLines(r) {
  const fs = findingsOf(r), missed = Array.isArray(r.missed) ? r.missed : [];
  return [
    ...fs.flatMap(p => p.findings.map(f => logRow({ name: columnLabel(r, p.column_id), detail: [f.message], cell: f.severity === 'block' ? 'Blocked' : 'Check', cellCh: 18 }))),
    ...(missed.length ? [logRow({ name: 'Possible missed values', cell: plural(missed.length, 'value'), cellCh: 18 }),
      ...missed.map((m, i) => logRow({ nameHtml: uiLink({ label: m.label, title: `Open page ${m.page}`, attrs: { 'data-missed': `${r.id}:${i}` } }), detail: [m.snippet, `p. ${m.page}`], cellCh: 18 }))] : []),
  ].join('');
}
const wireGate = (host, ctx, runs) => host.querySelectorAll('[data-missed]').forEach(b => b.onclick = () => {
  const [id, i] = b.dataset.missed.split(':'); const r = runs.find(x => x.id === id), m = r?.missed?.[+i];
  if (m) ctx.openDocument(r.paper_id, { page: Number(m.page), rects: [], quote: '' });
});
// ---- end numeric gate

// ---- the run log, for the inspector's Run section (views/extraction-fill.mjs) ---------------------------------------
/** Takes the person to the cell or row an exception of a batch report names. */
export async function openException(e, rec, ctx) {
  if (!e) return;
  if (rec.mode === 'patients') { if (focusRow(e.itemId)) ctx.go('patients'); return; }
  const { focusCell } = await import('./extraction.mjs');
  if (focusCell(e.paperId, e.itemId)) ctx.go('extraction');
}

/**
 * The log of the run in progress or the last one (its steps, newest last, and its usage line), then the earlier runs and batches of the
 * table as a disclosure. `wireRunLog` binds a missed value to its page and a batch row to its report.
 */
export function runLog({ steps = [], usage = '', templateId, open = false }) {
  const past = (get().runs || []).filter(r => r.kind !== 'batch' && r.template_id === templateId).slice(0, 5);
  const batches = batchRuns(get()).filter(r => r.mode === 'patients' || r.template_id === templateId).slice(0, 5);
  const batchRows = batches.map(r => logRow({ nameHtml: uiLink({ label: `Batch: ${r.mode === 'patients' ? 'patient rows' : 'table cells'}`, title: 'Open the report', attrs: { 'data-bx-record': r.id } }),
    detail: [recordLine(r), ago(r.startedAt)], cell: r.status, cellCh: 18 })).join('');
  const pastRows = batchRows + past.map(r => logRow({ name: `${r.kind}, ${r.status}`, detail: [shortModel(r.model), ago(r.startedAt), costText(r.usage), r.error], cell: tokenCell(r.usage), cellCh: 18 }) + gateLines(r)).join('');
  return `${steps.length || usage ? `<div class="run-log" id="run-log">${logList('run-steps', 'Run steps', steps.map(stepLine))}</div>${usage ? `<p class="meta" id="run-usage">${esc(usage)}</p>` : ''}` : ''}
    ${past.length + batches.length ? disclosure({ id: 'run-history', title: 'Earlier runs', count: past.length + batches.length, open: open || !steps.length, body: `<div class="run-log">${logList('run-past', 'Earlier runs', [pastRows])}</div>` }) : ''}`;
}
export function wireRunLog(host, ctx, templateId) {
  wireGate(host, ctx, (get().runs || []).filter(r => r.template_id === templateId));
  host.querySelectorAll('[data-bx-record]').forEach(b => b.onclick = () => { focusReport(b.dataset.bxRecord, { from: 'extraction' }); ctx.go('patients'); });
  const log = host.querySelector('#run-log'); if (log) log.scrollTop = log.scrollHeight;
}
/** One more step in the log on show, without a repaint. */
export function appendStep(st) {
  const list = document.querySelector('#run-log .ui-list'); if (!list) return;
  list.querySelector('.empty-state')?.remove(); list.insertAdjacentHTML('beforeend', stepLine(st));
  const log = list.closest('#run-log'); log.scrollTop = log.scrollHeight;
}
export { usageLine };

// A purely numeric cell is the record's ID number, not a name a reviewer
// would recognise; the first cell that has more than digits in it is the
// study.
const isNumeric = v => /^-?[\d.,\s%]+$/.test(String(v ?? '').trim());
const studyCellOf = cells => Object.values(cells).find(v => v && !isNumeric(v)) || '';

/** A workbook becomes a template; matched rows become imported proposals. `file` skips the file picker (a workbook from the project folder). */
/** A workbook or delimited file as rows; a CSV or TSV is one sheet named after the file. */
async function workbookOf(f) {
  if (/\.xlsx$/i.test(f.name)) return readXlsx(new Uint8Array(await f.arrayBuffer()));
  const { rows } = parseDelimited(decodeImport(new Uint8Array(await f.arrayBuffer())).text);
  return { sheets: [{ name: f.name.replace(/\.\w+$/, ''), rows }] };
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const TYPE_LABEL = Object.fromEntries(TYPES);

/**
 * A table file becomes proposals. Each of its columns goes to a column of the
 * table in view (`into`) when a header names one, to a column of a new table
 * read from the file (its type read from the values), or nowhere; the person
 * decides in the dialog, per column, before anything is written. Rows are
 * matched to records by DOI or "Surname year"; unmatched rows are skipped,
 * added as records, or matched by hand. `file` skips the file picker.
 */
export async function importTable(ctx, onDone, file = null, { into = 'default', path: trackedAt = null } = {}) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.csv,.tsv,.txt';
  input.onchange = async () => {
    const f = file || input.files?.[0]; if (!f) return;
    let wb, id, template, rows, warnings, layout;
    try {
      wb = await workbookOf(f);
      id = newTemplateId();
      ({ template, rows, warnings, layout } = templateFromWorkbook(wb, { id, name: f.name.replace(/\.(xlsx|csv|tsv|txt)$/i, '').replace(/[_-]+/g, ' ').slice(0, 40), file: f.name }));
    } catch (err) { ctx.rerender?.(`Could not read ${f.name}: ${String(err.message || err).slice(0, 100)}`); return; }
    const papers = get().papers;
    const matches = matchRows(rows, template, papers);
    // Where the file is in the project folder: the cells it gives are tracked against it (plan §4.15d); a file outside the folder cannot be.
    const folder = activeFolder();
    const trackPath = trackedAt || (folder ? await locateInFolder(folder, f).catch(() => null) : null);
    // Where each column goes, with the table in view's own columns offered by name.
    const targets = columnsOf(into).filter(c => !c.derived);
    const plan = template.columns.map(c => {
      const same = targets.find(t => norm(t.label) === norm(c.label) || norm(t.id.split('.').pop()) === norm(c.label));
      return { c, type: inferType(rows.map(r => r.cells[c.id])), field: same?.id || '' };
    });
    const applyImport = d => {
      d.querySelectorAll('[data-match]').forEach(sel => { const m = matches[+sel.dataset.match]; if (sel.value === '+') {
        const first = Object.values(m.row.cells).find(v => /\d{4}/.test(v)) || `Row ${m.row.index + 1}`;
        const pid = `imp-${id}-${m.row.index}`;
        update(s => { s.papers.push({ id: pid, key: pid, title: Object.values(m.row.cells).find(v => v.length > 40) || first, label: first.replace(/\s+et al\.?,?/, '').replace(/[†,]/g, '').slice(0, 40), authors: [], year: first.match(/\d{4}/)?.[0] || '', source: 'table', pdf: null }); return s; });
        m.paperId = pid;
      } else if (sel.value) m.paperId = sel.value; });
      const kept = [], fieldOf = new Map();
      plan.forEach((p, i) => {
        const v = d.querySelector(`[data-col="${i}"]`)?.value || 'skip';
        if (v === 'skip') return;
        if (v.startsWith('field:')) fieldOf.set(p.c.id, v.slice(6));
        else kept.push({ ...p.c, type: TYPE_LABEL[v.slice(4)] ? v.slice(4) : 'text' });
      });
      template.columns = kept;
      if (kept.length) saveTemplate(template);
      let n = 0;
      const held = {}, names = {};
      for (const m of matches) { if (!m.paperId) continue;
        for (const { c } of plan) { const v = m.row.cells[c.id]; if (!v) continue;
          const target = fieldOf.get(c.id) || (kept.some(k => k.id === c.id) ? c.id : null); if (!target) continue;
          const cell = trackPath && layout?.cols?.[c.id] != null ? refOf(m.row.index, layout.cols[c.id]) : '';
          const evidence = cell ? [{ kind: 'file', path: trackPath, locator: { sheet: layout.sheet, cell }, quote: v }] : [];
          propose(m.paperId, { column_id: target, value: v, normalized_value: v, availability: /^NR$/i.test(v) ? 'not_found' : 'present', evidence, rationale: '', origin: 'imported', mode: 'verify', verify: null, model: null, run_id: null }); n++;
          if (cell) { held[`${m.paperId}:${target}`] = { reported_value: v, evidence }; names[`${m.paperId}:${target}`] = `${papers.find(x => x.id === m.paperId)?.label || 'Study'}, ${c.label}`; } } }
      const table = trackPath && wb.sheets.find(x => x.name === layout?.sheet);
      const adoption = table && Object.keys(held).length ? evidenceAdoption({ path: trackPath, workbook: { sheets: [table] }, values: held, at: new Date().toISOString(), labelOf: key => names[key] }) : null;
      return { id: kept.length ? id : into, proposals: n, adoption };
    };
    const intoName = templateById(into)?.name || 'this table';
    const colOptions = p => [`<option value="skip">Leave out</option>`,
      ...(targets.length ? [`<optgroup label="Column of ${esc(intoName)}">${targets.map(t => `<option value="field:${esc(t.id)}"${p.field === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`] : []),
      `<optgroup label="New column of ${esc(template.name)}">${TYPES.map(([k, l]) => `<option value="new:${k}"${!p.field && p.type === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`].join('');
    let result = null;
    const unmatched = matches.some(m => !m.paperId);
    const columnRow = (p, i) => `<tr><td><strong>${esc(p.c.label)}</strong><span class="meta">${esc(rows.map(r => r.cells[p.c.id]).find(Boolean) || '')}</span></td>
      <td><select data-col="${i}" aria-label="Where ${esc(p.c.label)} goes">${colOptions(p)}</select></td></tr>`;
    const matchRow = (m, i) => m.paperId ? '' : `<tr><td><strong>Row ${m.row.index + 1}</strong><span class="meta">${esc(studyCellOf(m.row.cells))}</span></td>
      <td><select data-match="${i}" aria-label="Match row ${m.row.index + 1} to a study"><option value="">Skip</option><option value="+">Add as record</option>${papers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select></td></tr>`;
    const ok = await planDialog({ id: 'import-map', title: template.name, confirm: 'Import',
      detail: `${template.columns.length} columns, ${rows.length} rows, ${matches.filter(m => m.paperId).length} matched${warnings.length ? `, ${warnings.length} notes` : ''}`,
      body: `<table class="ask-table import-map"><thead><tr><th>Column</th><th>Goes to</th></tr></thead><tbody>${plan.map(columnRow).join('')}</tbody></table>
      ${unmatched ? `<table class="ask-table import-map"><thead><tr><th>Row</th><th>Matches</th></tr></thead><tbody>${matches.map(matchRow).join('')}</tbody></table>` : ''}`,
      onMount: d => { d.querySelector('form').addEventListener('submit', () => { result = applyImport(d); }, { capture: true }); } });
    if (ok && result) {
      // What the import took from each cell, recorded for the check against the file later; a record that cannot be written does not undo the import.
      if (result.adoption) { const r = await recordImport(folder, result.adoption); result.note = r.ok ? '' : 'The adoption record could not be written, so changes to the file are not tracked'; }
      else if (!trackPath && result.proposals) result.note = untrackedNote(folder);
      onDone(result.id, result);
    }
  };
  if (file) return input.onchange();
  input.click();
}

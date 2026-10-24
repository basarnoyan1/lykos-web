// The report of a batch extraction as a page body: what was read, which rules fired most, the exceptions that still wait (each opens
// its exact cell or row), and the two exports. One body serves the Report page of Patients (views/patient-review.mjs), which
// Extraction's earlier runs open too (lib/batch-report.mjs holds the numbers and the text; this draws them).
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiList, uiRow } from '../lib/ui-actions.mjs';
import { tableRegion, uiLink } from '../lib/ui-components.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { reportOf, batchRuns, exceptionsText, exportExceptions, exceptionsFileName, exportMasterList, masterListSheets } from '../lib/batch-report.mjs';
import { writeXlsx } from '../lib/xlsx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { researchType } from '../lib/workflow.mjs';
import { num } from '../lib/dates.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAGE = 25;

/** The batch's report in the shape the master list reads: tokens as { known }, the exceptions with every reason. */
const forExport = rec => { const r = rec.report || {}; return { ...r, endedAt: rec.endedAt, tokens: r.tokens ? { known: true, ...r.tokens } : { known: false }, exceptions: r.exceptions || [] }; };
const optsOf = rec => ({ mode: rec.mode, templateId: rec.mode === 'patients' ? undefined : rec.template_id, scope: rec.scope || 'included' });

/** Writes the master list of a batch (into the project folder by its version rule, else a file the person saves). Returns a sentence for the page. */
export async function exportMaster(rec, { report = null } = {}) {
  const folder = activeFolder(), now = get(), opts = optsOf(rec), rep = report || forExport(rec);
  try {
    if (folder) {
      const r = await exportMasterList(folder, now, opts, rep, { typeId: researchType(now).id });
      return r.failed.length ? `Not written: ${r.failed[0].error}` : r.written.length ? `Wrote ${r.written[0]}` : 'Unchanged since the last version in the folder';
    }
    await saveFile(await writeXlsx(masterListSheets(now, opts, rep)), `${rec.mode === 'patients' ? 'Patient' : 'Extraction'} master list.xlsx`, XLSX);
    return 'Master list saved';
  } catch (err) { return `Not written: ${String(err?.message || err).slice(0, 120)}`; }
}

/** Writes the rules and exceptions of a batch as text, for another model or person to review the sheet against. */
export async function exportExceptionList(rec) {
  const folder = activeFolder(), now = get();
  try {
    if (folder) {
      const r = await exportExceptions(folder, now, rec, { typeId: researchType(now).id });
      return r.failed.length ? `Not written: ${r.failed[0].error}` : r.written.length ? `Wrote ${r.written[0]}` : 'Unchanged since the last version in the folder';
    }
    await saveFile(new Blob([exceptionsText(now, rec)], { type: 'text/plain' }), exceptionsFileName(rec), 'text/plain');
    return 'Exceptions list saved';
  } catch (err) { return `Not written: ${String(err?.message || err).slice(0, 120)}`; }
}

const kv = rows => `<table class="bx-rep-kv"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(typeof v === 'number' ? num(v) : v)}</td></tr>`).join('')}</tbody></table>`;

/** The body of a report: summary, rules that fired, exceptions (a page of them), as markup. `page` is the exceptions' page. */
export function reportBodyHtml(rep, { page = 1 } = {}) {
  const open = rep.exceptions.filter(e => e.open), view = pageOf(open, page, PAGE);
  const rules = rep.rules.length ? tableRegion({ label: 'Rules that fired', html: `<table class="bx-rep-rules"><thead><tr><th scope="col">Rule</th><th scope="col" class="num">Flagged</th><th scope="col" class="num">Left</th></tr></thead>
    <tbody>${rep.rules.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${num(r.flagged)}</td><td class="num">${num(r.left)}</td></tr>`).join('')}</tbody></table>` }) : '<p class="meta">No rule fired</p>';
  const list = open.length ? uiList({ id: 'bx-rep-list', label: 'Exceptions', cols: ['cell'], rows: view.items.map((e, i) => {
      const at = (view.page - 1) * PAGE + i;
      return uiRow({ cls: 'bx-rep-row', main: { html: uiLink({ label: `${e.paper}, ${rep.mode === 'patients' && /^\d+$/.test(e.label || '') ? `case ${e.label}` : (e.label || e.itemId)}`, title: rep.mode === 'patients' ? 'Open this row' : 'Open this cell', attrs: { 'data-bx-open': String(at) } }),
        detail: e.reasons.map(r => esc(r.message)), wrap: true }, cells: [{ col: 'cell', kind: 'text', ch: 12, html: e.escalated ? 'Rechecked' : 'To review' }] });
    }) }) + pager({ id: 'bx-rep-pager', page: view.page, pages: view.pages, total: open.length, label: 'exceptions', size: PAGE })
    : '<p class="meta">Nothing left to review</p>';
  return `<div class="bx-rep">
    <section aria-label="Summary"><h3 class="bx-rep-h">Summary</h3>${kv(rep.rows)}</section>
    <section aria-label="Rules that fired"><h3 class="bx-rep-h">Rules that fired <span class="meta">${num(rep.rules.length)}</span></h3>${rules}</section>
    <section aria-label="To review"><h3 class="bx-rep-h">To review <span class="meta">${num(rep.open)}</span></h3>${rep.handled > 0 ? `<p class="meta">${num(rep.handled)} accepted, rejected or fixed since</p>` : ''}${rep.truncated ? `<p class="meta">The record keeps the first ${num(rep.exceptions.length)}</p>` : ''}${list}</section>
  </div>`;
}

/**
 * Draws the report of `rec` into `host` and wires its exceptions: `onOpen(exception)` is called for the one chosen.
 * Returns { redraw } so a caller that changed the project can show the new state.
 */
export function mountReportBody(host, rec, { onOpen }) {
  let page = 1;
  const redraw = () => {
    const rep = reportOf(rec, get());
    host.innerHTML = reportBodyHtml(rep, { page });
    wirePager(host, 'bx-rep-pager', n => { page = n; redraw(); });
    const open = rep.exceptions.filter(e => e.open);
    host.querySelectorAll('[data-bx-open]').forEach(b => b.onclick = () => onOpen(open[Number(b.dataset.bxOpen)], rep));
  };
  redraw();
  return { redraw };
}

export { batchRuns };

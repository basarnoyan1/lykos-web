// The PDF download notice, and what follows a download that did not get everything (PAPER-COVERAGE F5): Retry failed runs only the
// papers that failed, again, to the same folder; Write report puts `Not retrieved` beside the project's papers by the folder's
// version rule (one line per record: label, DOI, last source tried, reason, and whether an open-access copy was found), or saves it
// as a download when no folder is open. The notice counts the papers that came from an open-access source.
import { lib_dates$num as num } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiNotice as uiNotice } from "../boot.mjs";
import { uiMeter } from '../lib/ui-meter.mjs';
import { store$get as get, store$projects as projects } from "../boot.mjs";
import { retrievePaper } from '../lib/paper-download.mjs';
import { lib_files$getBytes as getBytes } from "../boot.mjs";
import { lib_native$savePdfToFolderNative as savePdfToFolderNative } from "../boot.mjs";
import { lib_library_records$pdfFilename as pdfFilename } from "../boot.mjs";
import { lib_save$saveFile as saveFile } from "../boot.mjs";
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { writeOutputs } from '../lib/project-folder.mjs';
import { lib_workflow$researchType as researchType } from "../boot.mjs";
import { reportText, retryPapers } from '../lib/retrieval-report.mjs';
import { oaColumn, isOpenProvider } from '../lib/open-access.mjs';

const paperOf = id => get().papers.find(p => p.id === id);
/** After a saved paper: counts it as open access when its source was one (lib/open-access.mjs). */
export const countOpen = (b, id) => { if (isOpenProvider(paperOf(id)?.pdfRetrieval?.provider)) b.open = (b.open || 0) + 1; };
/** What the open-access lookup said of a failed paper, as one sentence, or ''. */
const openLine = id => { const p = paperOf(id), c = oaColumn(p); return c === 'Open access' ? `Open access copy: ${p.openAccess.url}` : c === 'Not found' ? 'No open-access copy found' : ''; };

/** The download of the selected PDFs, as a notice; the papers that failed follow it. */
export function batchNoticeHtml(b) {
  const head = b.running ? `Downloading ${b.finished + 1} of ${b.total}…` : b.cancelled ? 'Download stopped.' : 'Download complete.';
  const failed = !b.running && b.errors.length > 0;
  // the pace so far gives the time left, once three papers are done; a notice without a start time (an old batch) says none
  const left = b.running && b.startedAt && b.finished >= 3 ? Math.max(1, Math.round((Date.now() - b.startedAt) / b.finished * (b.total - b.finished) / 60000)) : 0;
  const meter = b.running ? uiMeter({ id: 'lib-batch-meter', label: 'PDF download', done: b.finished, total: b.total, now: b.current || '', left: left ? `about ${left} min left` : '' }) : '';
  return uiNotice({ id: 'lib-batch', label: 'PDF download', text: `${head} ${num(b.saved)} saved${b.open ? `, ${num(b.open)} open access` : ''}, ${num(b.errors.length)} failed`,
      actions: b.running ? [{ id: 'lib-stop-download', label: 'Stop after this paper', icon: 'stop' }]
        : failed ? [{ id: 'lib-retry-failed', label: 'Retry failed', icon: 'refresh' }, { id: 'lib-report-failed', label: 'Write report', icon: 'file', role: 'quiet' }] : [] })
    + meter + (b.errors.length ? `<details class="lib-failures"><summary>Failed papers</summary>${b.errors.map(x => `<p><strong>${esc(x.label)}</strong> ${esc(x.error)}${openLine(x.id) ? `<br>${esc(openLine(x.id))}` : ''}</p>`).join('')}</details>` : '');
}

/** The failures of a batch as the report reads them: label, DOI from the library, the error each carried, the open-access finding. */
const failuresOf = b => b.errors.map(e => { const p = paperOf(e.id); return { ...e, doi: e.doi ?? p?.doi ?? '', oa: oaColumn(p), oaUrl: p?.openAccess?.url || '' }; });

/** Runs the papers that failed again, in the same batch and to the same folder; `ctx.rerender()` follows every paper. `deps` replaces the retrieval, the bytes and the save (the tests). */
export async function retryFailed(b, ctx, { findPdf = retrievePaper, bytesOf = getBytes, save = savePdfToFolderNative } = {}) {
  if (!b || b.running || !b.errors.length || !b.dir) return;
  const project = projects().current;
  const again = retryPapers(failuresOf(b), get().papers);
  if (!again.length) return;
  Object.assign(b, { running: true, cancelled: false, total: again.length, finished: 0, errors: [], startedAt: Date.now(), current: '' });
  ctx.rerender();
  try {
    for (const paper of again) {
      if (b.cancelled || projects().current !== project) { b.cancelled = true; break; }
      b.current = paper.label || paper.title || ''; ctx.rerender();
      try {
        await findPdf(paper.id);
        if (projects().current !== project) { b.cancelled = true; break; }
        const bytes = await bytesOf(paper.id);
        if (!bytes) throw new Error('No PDF returned');
        await save(b.dir, pdfFilename(paper), bytes);
        b.saved++; countOpen(b, paper.id);
      } catch (e) { b.errors.push({ id: paper.id, label: paper.label || paper.title, error: String(e.message || e) }); }
      b.finished++; ctx.rerender();
    }
  } finally { b.running = false; ctx.rerender(); }
}

/** Writes the report: into the project's papers folder by the version rule, else as a download. Returns the sentence to show. */
export async function writeReport(b, folder = activeFolder()) {
  const text = reportText(failuresOf(b));
  if (!text) return 'Nothing failed';
  if (!folder) { saveFile(text, 'Not retrieved.txt', 'text/plain'); return `${num(b.errors.length)} failed papers listed in Not retrieved.txt`; }
  const r = await writeOutputs(folder, [{ key: 'papers', stem: 'Not retrieved', ext: 'txt', data: text, label: 'PDFs not retrieved', kind: 'library' }], { typeId: researchType(get()).id });
  if (r.failed.length) return `Report not written: ${r.failed[0].error}`;
  return r.unchanged.length ? 'Report unchanged since its last version' : `Report written: ${r.written[0]}`;
}

/** Wires the notice's two follow-up actions; the Stop action is the view's. */
export function wireBatchNotice(el, ctx, b) {
  el.querySelector('#lib-retry-failed')?.addEventListener('click', () => retryFailed(b, ctx));
  el.querySelector('#lib-report-failed')?.addEventListener('click', async () => {
    try { ctx.rerender(await writeReport(b)); } catch (err) { ctx.rerender(String(err.message || err).slice(0, 140)); }
  });
}

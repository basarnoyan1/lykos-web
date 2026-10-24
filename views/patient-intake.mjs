// Patients > Intake: the case papers a person has dropped in, and what each is waiting for (PAPER-COVERAGE F1).
//
// Add PDFs copies each file into the project's papers folder as `NN - Author YYYY.pdf` and matches it to a record by DOI or title
// (lib/case-intake.mjs); Extract new reads the matched ones as the patient batch (lib/extract-batch.mjs), and what it finds waits on the
// Proposed page with its quotes. A row reads one of: Queued, Proposed n rows, Accepted, Excluded, Unmatched, Already in the project.
import { get } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiSwap, CH_STEPS } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { askText } from '../lib/dialog.mjs';
import { askRecord } from '../lib/record-picker.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { papersDir } from '../lib/project-folder.mjs';
import { putFile, getFile } from '../lib/files.mjs';
import { researchType } from '../lib/workflow.mjs';
import { num } from '../lib/dates.mjs';
import { running as runningJobs, onProgress } from '../lib/jobs.mjs';
import { exportRulesFile } from '../lib/extract-batch.mjs';
import { intakeRows, intakeCounts, queuedPapers, addCaseFiles, dropSummary, relinkItem, keepRecord, excludeItem, includeItem, readAgain, removeItem } from '../lib/case-intake.mjs';
import { batch, startBatch, stopBatch } from './batch-control.mjs';
import { pagedList, wirePagedLists } from '../lib/paged-list.mjs';

const ui = { note: '', over: false };
export const resetIntake = () => { ui.note = ''; ui.over = false; };
export const clearIntakeNote = () => { ui.note = ''; };

const isRunning = () => batch.running || runningJobs().some(j => j.kind === 'extract');

const STATE_LABEL = { queued: 'Queued', unmatched: 'Unmatched', duplicate: 'Already in the project', excluded: 'Excluded', accepted: 'Accepted', read: 'No rows left' };
const stateText = r => r.state === 'proposed' ? `Proposed ${num(r.rows)} ${r.rows === 1 ? 'row' : 'rows'}` : STATE_LABEL[r.state];
const HOW = { 'matched-doi': 'Matched by DOI', 'matched-title': 'Matched by title', 'matched-text': 'Matched by the first page', 'new-from-doi': 'New record from DOI', 'new-from-title': 'New record from title', chosen: 'Record chosen', 'new-from-pdf-kept': 'New record from the file' };

/** The status slot: the queue in words, or the progress of the batch that is reading it. */
export function statusText(state = get()) {
  const job = runningJobs().find(j => j.kind === 'extract');
  if (job) return job.total ? `Reading ${num(job.done || 0)} of ${num(job.total)}` : 'Reading';
  const c = intakeCounts(state);
  return [c.new ? `${num(c.new)} new` : '', c.unmatched ? `${num(c.unmatched)} unmatched` : ''].filter(Boolean).join(', ');
}

const chOf = rows => CH_STEPS.find(c => c >= Math.max(0, ...rows.map(r => stateText(r).length))) || CH_STEPS.at(-1);

function rowHtml(r, ch) {
  const { item, paper } = r;
  const record = paper ? (paper.label || paper.title) : 'No record';
  const detail = r.state === 'excluded' ? [record, item.excluded]
    : r.state === 'accepted' ? [record, `${num(r.patients)} ${r.patients === 1 ? 'patient' : 'patients'}`]
    : r.state === 'unmatched' ? ['No record chosen']
    : r.state === 'duplicate' ? [`${record}${item.how === 'has-pdf' ? ', which has a different PDF' : ''}`]
    : [record, HOW[item.how] || ''];
  const more = { label: `More for ${item.name}`, attrs: { 'data-ci-more': item.id } };
  return uiRow({ cls: 'ipd-ci-row', attrs: { 'data-ci-row': item.id, 'data-ci-state': r.state },
    main: { html: esc(item.name), detail: detail.filter(Boolean).map(esc), wrap: true },
    cells: [{ col: 'state', kind: 'text', ch, html: esc(stateText(r)) }],
    end: uiRowEnd(r.state === 'unmatched' ? { primary: { id: `ci-pick-${item.id}`, label: 'Choose record', icon: 'library', attrs: { 'data-ci-pick': item.id } }, more } : { more }) });
}

export function intakeHtml(state = get()) {
  const rows = intakeRows(state), counts = intakeCounts(state), running = isRunning(), queued = queuedPapers(state).length;
  const ch = chOf(rows);
  const page = pagedList('ci-rows', rows, { label: 'case papers' });   // fifty a page, the page kept across redraws
  const list = uiList({ id: 'ci-rows', label: 'Case papers', cols: ['state'], rows: page.items.map(r => rowHtml(r, ch)),
    empty: emptyState({ icon: 'file-pdf', title: 'No case papers', detail: 'Case-report PDFs, matched to records and read for patient rows.' }) }) + page.pager;
  return `<div class="panel ipd-panel ipd-ci" id="ipd-body"${ui.over ? ' data-drop' : ''}>
    ${uiBar({ kind: 'head', label: 'Case papers', id: 'ci-head', lead: { title: 'Case papers' }, status: { id: 'ci-status', text: statusText(state), ch: 24 }, message: { id: 'ci-note', text: ui.note },
      actions: [uiSwap({ id: 'ci-run-slot', members: [{ id: 'ci-run', label: 'Extract new', icon: 'extract', disabled: !queued, hidden: running }, { id: 'ci-stop', label: 'Stop', icon: 'stop', hidden: !running }] }),
        { id: 'ci-add', label: 'Add PDFs', icon: 'file-pdf', role: 'primary' }],
      overflow: [{ id: 'ci-rules', label: 'Rules' }, { id: 'ci-rules-file', label: 'Write rules file' }] })}
    <div class="ipd-cq" id="ci-drop">${list}</div></div>`;
}

const pickPdfs = fn => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.pdf,application/pdf'; i.multiple = true; i.hidden = true; i.id = 'ci-file';
  document.body.appendChild(i);
  i.onchange = async () => { try { if (i.files.length) await fn([...i.files]); } finally { i.remove(); } };
  i.oncancel = () => i.remove();
  i.click();
};

/** What a record picker offers for an unmatched file: every record with no PDF of its own. */
const candidates = () => (get().papers || []).filter(p => !p.pdf);

/**
 * Wires the page. `go` takes the person elsewhere: { proposed(paperId), rules(), pdf(paperId) }.
 * Returns nothing; every handler redraws through ctx.rerender().
 */
export function wireIntake(el, ctx, go) {
  const redraw = note => { if (note != null) ui.note = note; ctx.rerender(); ctx.refreshCounts?.(); };
  wirePagedLists(el, () => redraw());
  const say = text => { ui.note = text; const n = el.querySelector('#ci-note'); if (n) { n.textContent = text; n.title = text; } };
  const add = async files => {
    const folder = activeFolder();
    const dir = folder ? await papersDir(folder, researchType(get()).id) : '';
    const { placeFile, markFolderPdf } = await import('./library.mjs');
    const r = await addCaseFiles(files, { place: placeFile, folder, papersDir: dir, attach: markFolderPdf, putFile, say });
    redraw(dropSummary(r));
  };
  const statusNode = el.querySelector('#ci-status');
  const live = onProgress(() => { if (statusNode.isConnected) statusNode.textContent = statusText(); else live(); });
  el.querySelector('#ci-add').onclick = () => pickPdfs(add);
  el.querySelector('#ci-stop').onclick = stopBatch;
  el.querySelector('#ci-run').onclick = async () => {
    const ids = queuedPapers(); if (!ids.length) return;
    ui.note = '';
    const report = await startBatch(ctx, { mode: 'patients', scope: 'selected', paperIds: ids }, () => ctx.rerender());
    const failed = report?.errors?.length || 0;
    const read = (report?.runs || []).filter(r => r.tier === 'cheap' && r.status === 'done').length;
    ui.note = report ? [`${num(read)} read`, report.remaining ? `${num(report.remaining)} to review` : '', failed ? `${num(failed)} failed: ${report.errors[0].error}` : '', report.stopped ? 'stopped' : ''].filter(Boolean).join(', ') : batch.summary;
    ctx.rerender();
  };
  el.querySelector('#ci-rules').onclick = () => go.rules();
  el.querySelector('#ci-rules-file').onclick = async () => {
    const folder = activeFolder(), state = get();
    if (!folder) { redraw('Open a project folder to write the rules file'); return; }
    try {
      const r = await exportRulesFile(folder, state, { typeId: researchType(state).id });
      redraw(r.failed.length ? `Not written: ${r.failed[0].error}` : r.written.length ? `Wrote ${r.written[0]}` : 'Unchanged since the last version in the folder');
    } catch (err) { redraw(`Not written: ${String(err?.message || err).slice(0, 120)}`); }
  };
  // the list takes dropped files; the panel's fill says so while one is over it
  const panel = el.querySelector('#ipd-body'), files = e => [...(e.dataTransfer?.types || [])].includes('Files');
  panel.addEventListener('dragover', e => { if (!files(e)) return; e.preventDefault(); if (!ui.over) { ui.over = true; panel.setAttribute('data-drop', ''); } });
  panel.addEventListener('dragleave', e => { if (e.relatedTarget && panel.contains(e.relatedTarget)) return; ui.over = false; panel.removeAttribute('data-drop'); });
  panel.addEventListener('drop', e => { if (!files(e)) return; e.preventDefault(); ui.over = false; panel.removeAttribute('data-drop'); add([...e.dataTransfer.files]); });
  const itemOf = id => (get().intake || []).find(i => i.id === id);
  el.querySelectorAll('[data-ci-pick]').forEach(b => b.onclick = async () => {
    const id = b.dataset.ciPick, item = itemOf(id); if (!item) return;
    if (!candidates().length) { redraw('Every record has a PDF. Keep this file as a new record, or add its record in Library'); return; }
    const chosen = await askRecord('Record', { records: candidates() }); if (!chosen) return;
    const folder = activeFolder();
    const r = await relinkItem(id, chosen, { folder, moveFile: async (from, to) => { const blob = await getFile(from); if (blob) await putFile(to, blob); } });
    redraw(r.ok ? 'File linked to the record' : r.reason);
  });
  el.querySelectorAll('[data-ci-more]').forEach(b => b.onclick = () => {
    const id = b.dataset.ciMore, row = intakeRows().find(r => r.item.id === id); if (!row) return;
    const items = [];
    if (row.paper?.pdf) items.push({ label: 'Open PDF', run: () => go.pdf(row.paper.id) });
    if (row.state === 'proposed') items.push({ label: 'Open proposed rows', run: () => go.proposed(row.paper.id) });
    if (row.state === 'read') items.push({ label: 'Read again', run: () => { readAgain(id); redraw(); } });
    if (row.state === 'excluded') items.push({ label: 'Include again', run: () => { includeItem(id); redraw(); } });
    if (row.state === 'unmatched') items.push({ label: 'Keep as a new record', run: () => { keepRecord(id); redraw('The record made from the file stays'); } });
    if (['queued', 'unmatched'].includes(row.state)) items.push({ label: 'Leave out…', run: async () => { const why = await askText('Why leave this paper out', { placeholder: 'For example: not a case report', confirm: 'Leave out' }); if (why == null) return; excludeItem(id, why); redraw(); } });
    items.push({ label: 'Remove from list', run: () => { removeItem(id); redraw(); } });
    showMenu(b, items, { align: 'end' });
  });
}

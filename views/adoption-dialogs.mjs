// The three things a person can do about an adopted file (plan §4.15d). Adopt and Write back are plans: a dialog that shows what will happen before it
// does anything. Compare is read and decided beside the folder page, in the inspector:
//
//   openAdopt(folder, path)         "Adopt this file": what is read, what becomes tracked, what the app takes from the file. Confirm records it.
//   planDifferences / applyDifferences   the cells where the file or the app moved, one choice each (take the file's value, keep the app's): the inspector section Differences, not a dialog.
//   openWriteBack(folder, path)     "Write back to workbook": the exact cells of the file that will change, ticked, paged. Confirm writes them; nothing else is written.
//
// The dialogs resolve to `{ changed, message }` once they close; `changed` says whether the folder, the record or the app's values moved. Cancel,
// Escape and a click outside write nothing. A plan is made before the dialog opens from the file as it is and carries its hash: a file that moved
// while the dialog was open is refused at confirm (lib/adoption.mjs), never overwritten.
import { esc } from '../lib/html.mjs';
import { confirmAsk, planDialog } from '../lib/dialog.mjs';
import { uiList, uiRow, inspectorActions } from '../lib/ui-actions.mjs';
import { pager, wirePager } from '../lib/paging.mjs';
import { disclosure } from '../lib/ui-components.mjs';
import { day, plural } from '../lib/dates.mjs';
import { baseName } from '../lib/fsys.mjs';
import { planAdoption, applyAdoption, planWrite, applyWrite, versionOf } from '../lib/adoption.mjs';
import { canWriteBack } from '../lib/drift.mjs';
import { size } from './file-doc.mjs';

const PAGE = 8;
let serial = 0;
const ROLE_LABEL = { evidence: 'Evidence table', ipd: 'Master list', screening: 'Screening sheet', manuscript: 'Manuscript', other: 'Other file' };
const clip = (t, n = 40) => { const x = String(t ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const q = t => `"${clip(t)}"`;

const sheet = rows => `<table class="ask-table adopt-table"><tbody>${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

const reasonLines = list => list.map(s => `<li>${esc(s)}</li>`).join('');

// ---- Adopt this file --------------------------------------------------------------------------------------------------------
export async function openAdopt(folder, path, { say = () => {} } = {}) {
  const plan = await planAdoption(folder, path);
  if (!plan.ok) { say(plan.reason); return { changed: false, message: plan.reason }; }
  const id = `adopt-${++serial}`, name = baseName(path);
  const file = `${size(plan.file.size || 0)}${plan.file.mtime ? ` · ${day(plan.file.mtime)}` : ''}`;
  let rows;
  if (plan.kind === 'new') {
    const tracked = plan.cells ? `${plural(plan.cells, 'cell')}, each with the text it holds in the file and the value the app holds` : 'None by cell; the file is tracked by its content';
    rows = [['File', `${esc(name)} · ${esc(file)}`], ['Read as', esc(ROLE_LABEL[plan.role] || 'Other file')], ['Tracked', esc(tracked)],
      plan.cells ? ['Same in the app', esc(`${plural(plan.cells - plan.differ, 'cell')} hold what the file says`)] : null,
      plan.differ ? ['Different in the app', esc(`${plural(plan.differ, 'cell')}; the file is the reference, so they show as edited in the app`)] : null,
      ['Changes to the app', 'None. Adopting records the file; it changes no value'], ['Changes to the file', 'None']];
  } else if (plan.kind === 'moved') {
    rows = [['File', `${esc(name)} · ${esc(file)}`], ['Read as', esc(ROLE_LABEL[plan.role] || 'Other file')],
      ['Taken from the file', esc(plan.take.length ? `${plural(plan.take.length, 'value')}: the app takes what the file now says` : 'None')],
      ['Kept in the app', esc(plan.keep.length ? `${plural(plan.keep.length, 'cell')} where only the app changed; they stay available to write back` : 'None')],
      ['Left to decide', esc(plan.decide.length ? `${plural(plan.decide.length, 'cell')} changed on both sides; decide each in Compare. The file stays marked changed until then` : 'None')],
      ['Changes to the file', 'None']];
  } else { const message = `${name} is as adopted; there is nothing to take or keep`; say(message); return { changed: false, message }; }
  const preview = plan.take.slice(0, 5);
  const body = `${sheet(rows)}${plan.notes.length ? `<ul class="adopt-notes">${reasonLines(plan.notes)}</ul>` : ''}${preview.length ? `<div class="adopt-preview">${uiList({ id: `${id}-preview`, label: 'Values taken from the file', rows: preview.map(d => uiRow({ main: { html: `<span class="adopt-name">${esc(d.name)}</span>`, detail: [esc(`app ${q(d.appText)}`), esc(`file ${q(d.fileText)}`)] } })) })}${plan.take.length > preview.length ? `<p class="meta">and ${plural(plan.take.length - preview.length, 'more value')}</p>` : ''}</div>` : ''}`;
  const go = await planDialog({ id: 'adopt-file', title: `Adopt ${clip(name, 36)}`, body, confirm: 'Adopt file' });
  if (!go) return { changed: false, message: '' };
  const r = await applyAdoption(folder, path, Object.fromEntries(plan.take.map(x => [x.k, 'take'])), { expect: plan.token });
  const message = !r.ok ? r.reason : `Adopted ${name}${r.took ? `; ${plural(r.took, 'value')} taken from the file` : ''}${r.skipped.length ? `; ${plural(r.skipped.length, 'value')} not taken (${r.skipped[0].reason})` : ''}${r.left ? `; ${plural(r.left, 'cell')} still differ` : ''}`;
  say(message);
  return { changed: r.ok, message };
}

// ---- Compare ---------------------------------------------------------------------------------------------------------------
// Not a dialog: the folder page's inspector section Differences (views/files.mjs) draws the cells and keeps the choices. These two functions are its
// reading and its writing, so the section holds no plan logic: `planDifferences` reads the file as it is (the plan carries its hash), `applyDifferences`
// records the choices and refuses a file that moved meanwhile (lib/adoption.mjs).
export const STATUS = { file: 'file changed', app: 'app changed', both: 'both changed' };
/**
 * The cells where the file or the app moved, or null with the reason said. `writable` is whether the file's role is written back
 * (lib/drift.mjs WRITE_BACK_ROLES) and the app is ahead in some cell; a screening workbook or a manuscript never offers Write back.
 */
export async function planDifferences(folder, path, { say = () => {} } = {}) {
  const plan = await planAdoption(folder, path);
  if (!plan.ok) { say(plan.reason); return null; }
  const diffs = plan.diffs || [];
  if (!diffs.length) { say('No cell differs from the record'); return null; }
  const writable = canWriteBack(plan.role) && /\.xlsx$/i.test(path) && (await planWrite(folder, path)).changes.length > 0;
  return { plan, diffs, writable, token: plan.token };
}
/** Records `choice` (a Map of cell key to 'take' or 'keep'). Resolves to `{ changed, message }`. */
export async function applyDifferences(folder, path, found, choice, { say = () => {} } = {}) {
  if (!choice.size) return { changed: false, message: '' };
  const r = await applyAdoption(folder, path, Object.fromEntries(choice), { expect: found.token });
  const message = !r.ok ? r.reason : [r.took ? `${plural(r.took, 'value')} taken from the file` : '', r.kept ? `${plural(r.kept, 'value')} kept in the app` : '', r.skipped.length ? `${plural(r.skipped.length, 'value')} not taken (${r.skipped[0].reason})` : ''].filter(Boolean).join('; ') || 'No change';
  say(message);
  return { changed: r.ok, message };
}

const DIFF_PAGE = 8;
const decidedText = c => `${c.choice.size} of ${c.found.diffs.length} decided`;
/**
 * The inspector section Differences for the comparison `c` ({ found: { diffs, writable }, choice: Map, page }; the caller keeps it, because the inspector
 * is drawn again on every change). A choice updates the count and the Apply act in place and never redraws the list under the pointer; paging and the
 * bulk choices ask the caller to draw again (`refresh`). `cancel()` drops the comparison, `finish('apply' | 'write')` records the choices or goes on to the
 * write back plan.
 */
export function differencesSection(c, { refresh = () => {}, cancel = () => {}, finish = () => {} } = {}) {
  const { diffs, writable } = c.found, pages = Math.max(1, Math.ceil(diffs.length / DIFF_PAGE));
  c.page = Math.min(Math.max(1, c.page), pages);
  const pick = d => `<select data-k="${esc(d.k)}" aria-label="${esc(`Decision for ${d.name}`)}"><option value="">Decide later</option><option value="take"${c.choice.get(d.k) === 'take' ? ' selected' : ''}>Keep file value</option><option value="keep"${c.choice.get(d.k) === 'keep' ? ' selected' : ''}>Keep app value</option></select>`;
  const rows = diffs.slice((c.page - 1) * DIFF_PAGE, c.page * DIFF_PAGE).map(d => uiRow({ attrs: { 'data-k': d.k },
    main: { html: `<span class="adopt-name" title="${esc(d.name)}">${esc(d.name)}</span>`, wrap: true,
      detail: [esc(`${d.ref} · ${STATUS[d.status]}`), esc(`Adopted ${q(d.adopted)}`), esc(`File ${d.fileText == null ? 'sheet gone' : q(d.fileText)}`), esc(`App ${q(d.appText)}`)] },
    cells: [{ col: 'decision', kind: 'control', html: pick(d) }] }));
  const acts = [{ id: 'fv-diff-cancel', label: 'Cancel', role: 'quiet' }, { id: 'fv-diff-apply', label: 'Apply decisions', role: writable ? 'secondary' : 'primary', disabled: !c.choice.size },
    ...(writable ? [{ id: 'fv-diff-write', label: 'Write back', role: 'primary' }] : [])];
  return { title: 'Differences', meta: String(diffs.length),
    html: `<p class="meta" id="fv-diff-n" role="status">${esc(decidedText(c))}</p>${uiList({ id: 'fv-diff-list', label: 'Cells that differ', cols: ['decision'], rows })}${pager({ id: 'fv-diff-pager', page: c.page, pages, total: diffs.length, label: 'cells', size: DIFF_PAGE })}${inspectorActions({ label: 'Comparison actions', id: 'fv-diff-acts', actions: acts,
      overflow: [{ id: 'fv-diff-all-file', label: 'Keep the file\u2019s value everywhere' }, { id: 'fv-diff-all-app', label: 'Keep the app\u2019s value everywhere' }, { id: 'fv-diff-clear', label: 'Clear all decisions' }] })}`,
    wire: el => {
      const sync = () => { const n = el.querySelector('#fv-diff-n'); if (n) n.textContent = decidedText(c); const a = el.querySelector('#fv-diff-apply'); if (a) a.disabled = !c.choice.size; };
      el.addEventListener('change', e => { const s = e.target.closest('select[data-k]'); if (!s) return; if (s.value) c.choice.set(s.dataset.k, s.value); else c.choice.delete(s.dataset.k); sync(); });
      wirePager(el, 'fv-diff-pager', n => { c.page = n; refresh(); });
      const all = value => () => { c.choice.clear(); if (value) for (const x of diffs) if (!(value === 'take' && x.fileText == null)) c.choice.set(x.k, value); refresh(); };
      el.querySelector('#fv-diff-all-file')?.addEventListener('click', all('take'));
      el.querySelector('#fv-diff-all-app')?.addEventListener('click', all('keep'));
      el.querySelector('#fv-diff-clear')?.addEventListener('click', all(''));
      el.querySelector('#fv-diff-cancel')?.addEventListener('click', cancel);
      el.querySelector('#fv-diff-apply')?.addEventListener('click', () => finish('apply'));
      el.querySelector('#fv-diff-write')?.addEventListener('click', () => finish('write'));
    } };
}

// ---- Write back -------------------------------------------------------------------------------------------------------------
export async function openWriteBack(folder, path, { say = () => {} } = {}) {
  const plan = await planWrite(folder, path);
  const changes = plan.changes;
  if (!changes.length) {
    const why = plan.skipped[0]?.reason, message = why ? `Nothing to write back: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : 'The app is not ahead of the file in any cell';
    say(message); return { changed: false, message };
  }
  const id = `wb-${++serial}`, name = baseName(path || plan.files[0].path);
  const on = new Set(changes.map(c => c.k));
  let page = 1, body = null;
  const draw = () => { body.innerHTML = list(); wirePager(body, `${id}-pager`, n => { page = n; draw(); }); };
  const pages = () => Math.max(1, Math.ceil(changes.length / PAGE));
  const row = c => uiRow({ cls: 'adopt-row', attrs: { 'data-k': c.k }, check: { checked: on.has(c.k), label: `Write ${c.name}`, attrs: { 'data-k': c.k } },
    main: { html: `<span class="adopt-name" title="${esc(c.name)}">${esc(c.name)}</span>`, wrap: true, detail: [esc(`${c.sheet} ${c.cell}`), esc(`${q(c.from)} to ${q(c.to)}`)] } });
  const list = () => `${uiList({ id: `${id}-list`, label: 'Cells to write', rows: changes.slice((page - 1) * PAGE, page * PAGE).map(row) })}${pager({ id: `${id}-pager`, page, pages: pages(), total: changes.length, label: 'cells', size: PAGE })}`;
  const statusText = () => `${on.size} of ${changes.length} cells`;
  const notOffered = plan.skipped.length ? disclosure({ id: `${id}-skipped`, title: 'Not offered', count: plan.skipped.length, body: `<ul class="adopt-notes">${reasonLines(plan.skipped.slice(0, 20).map(s => `${s.sheet} ${s.cell}: ${s.reason}`))}</ul>` }) : '';
  let ok = null, detail = null, toggle = null;
  const refresh = () => { if (detail) detail.textContent = statusText(); if (ok) ok.disabled = on.size === 0; if (toggle) toggle.textContent = on.size === changes.length ? 'Untick all' : 'Tick all'; };
  const go = await planDialog({ id: 'adopt-write-back', title: `Write back to ${clip(name, 30)}`, detail: statusText(), confirm: 'Write to workbook',
    start: { id: 'toggle', label: 'Untick all' }, body: `<div id="${id}-body">${list()}</div>${notOffered}`,
    onAct: () => { if (on.size === changes.length) on.clear(); else for (const c of changes) on.add(c.k); draw(); refresh(); return true; },
    onMount: d => {
      body = d.querySelector(`[id="${id}-body"]`); ok = d.querySelector('[type=submit]'); detail = d.querySelector('.ask-detail'); toggle = d.querySelector('[data-start]');
      draw();
      body.addEventListener('change', e => { const c = e.target.closest('input[type=checkbox][data-k]'); if (!c) return; if (c.checked) on.add(c.dataset.k); else on.delete(c.dataset.k); refresh(); });
    } });
  if (!go || !on.size) return { changed: false, message: '' };
  const target = plan.files[0] && versionOf(plan.files[0].path);
  const yes = await confirmAsk(`Write ${plural(on.size, 'cell')} into ${name}?`, { confirm: 'Write', detail: `Only these cells change. The previous file moves to ${target.archive} and the new version is saved as ${baseName(target.next)}.` });
  if (!yes) return { changed: false, message: '' };
  const r = await applyWrite(folder, plan, [...on]);
  const wrote = r.written.reduce((n, w) => n + w.cells, 0);
  const to = r.written[0];
      const message = wrote ? `Wrote ${plural(wrote, 'cell')} into ${baseName(to.path)}; ${baseName(to.from || path)} is in ${to.archived ? to.archived.slice(0, to.archived.lastIndexOf('/')) : 'the archive'}${r.skipped.length ? `; ${r.skipped[0].reason}` : ''}` : (r.skipped[0]?.reason || 'Nothing was written');
  say(message);
  return { changed: wrote > 0, message, moved: wrote && to?.from ? { from: to.from, to: to.path } : null };
}


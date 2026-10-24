// The evidence-table exports from the app (plan §4.15a, evidence exports
// amendment 2026-09-28): the publication workbook, the with-sources workbook
// and the Word tables, downloaded from Extraction's Export menu or written
// into the project folder by its version rule after a preview; and the Word
// tables' columns and captions, edited per table on a sub-page of Extraction
// (DIALOGS plan #48).
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { planDialog } from '../lib/dialog.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { tableRegion, cueRegions } from '../lib/ui-components.mjs';
import { saveFile } from '../lib/save.mjs';
import { evidenceModel, publicationWorkbook, sourcesWorkbook, wordDocument, wordTables, nextRound } from '../lib/evidence-export.mjs';
import { evidencePlan, planRows, applyEvidencePlan, sameParts } from '../lib/evidence-folder.mjs';
import { projectLayout, ensureDir, outputsLog } from '../lib/project-folder.mjs';
import { moveEvidencePaths } from '../lib/fields.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const bytes = async b => b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer());
const slug = t => String(t.name || 'evidence-table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const templateOf = id => (get().templates || []).find(t => t.id === id);

/** Studies-as-rows templates with values: what the folder can write. */
export const publishable = (s = get()) => (s.templates || []).filter(t => t.orientation === 'studies-rows' && Object.keys(s.values || {}).some(k => k.includes(`:${t.id}.`)));

// A with-sources export is a revision round: its changes since the last one are logged and kept.
function keepRound(templateId, r, extra = {}) {
  update(s => {
    const t = (s.templates || []).find(x => x.id === templateId);
    if (t) { t.exportLog = { snapshot: r.snapshot, rounds: r.rounds }; Object.assign(t, extra); }
    return s;
  });
}

/** Items for Extraction's Export menu on a studies-as-rows table. */
/** `rerender` repaints Extraction: Word table columns opens its sub-page. */
export function evidenceExportItems(templateId, rerender = () => {}) {
  const t = templateOf(templateId);
  if (!t) return [];
  const model = () => evidenceModel(get(), templateId);
  return [
    { label: 'Publication table (Excel)', run: async () => saveFile(await publicationWorkbook(model()), `${slug(t)}.xlsx`, XLSX) },
    { label: 'Table with sources (Excel)', run: async () => {
      const m = model(), r = nextRound(m);
      await saveFile(await sourcesWorkbook(m, { rounds: r.rounds, snapshot: r.snapshot }), `${slug(t)}-with-sources.xlsx`, XLSX);
      if (r.round) keepRound(templateId, r);
    } },
    { label: 'Tables (Word)', run: async () => saveFile(await wordDocument(model()), `${slug(t)}-tables.docx`, DOCX) },
    { label: 'Word table columns', run: () => { if (openWordTables(templateId)) rerender(); } },
  ];
}

// ---- the Word tables' columns ---------------------------------------------------
// A sub-page of Extraction with Back in the title bar: one column per Word table, a caption row and a tick per column, and Save in the foot.
// The draft lives here, in the module, so a repaint of the page never loses it; Back leaves it unsaved, as Cancel did.
let wordDraft = null;   // { templateId, tables, caps: [caption], on: [Set of column ids] }

/** Whether the sub-page is the page shown; Extraction draws it in place of its table. */
export const wordTablesOpen = () => !!wordDraft;
/** Opens the sub-page on the Word tables of an evidence table; false when it has none to edit. */
export function openWordTables(templateId) {
  if (!templateOf(templateId)) return false;
  const tables = wordTables(evidenceModel(get(), templateId)).map(x => ({ ...x, columns: [...x.columns] }));
  if (!tables.length) return false;
  wordDraft = { templateId, tables, caps: tables.map(x => x.caption || ''), on: tables.map(x => new Set(x.columns)) };
  return true;
}
/** Back, or leaving Extraction: the page comes back on its table and the draft is dropped. */
export function closeWordTables() { wordDraft = null; }
/** The title bar of the sub-page: Back to Extraction and its name. */
export function wordTablesSpec(run = {}) {
  return { title: 'Word tables', back: { label: 'Back to Extraction', run: run.back || (() => {}) }, actions: [], overflow: [] };
}

/** The sub-page under Extraction's title bar. `ctx.rerender` repaints the page and its title bar. */
export function renderWordTables(el, ctx) {
  const d = wordDraft, t = d && templateOf(d.templateId);
  if (!d || !t) { wordDraft = null; ctx.rerender(); return; }
  const s = get(), name = x => (s.collections || []).find(c => c.id === x.collection)?.name || x.collection;
  const grid = `<table class="ev-wt"><thead><tr><th scope="col">Column</th>${d.tables.map(x => `<th scope="col">${esc(name(x))}</th>`).join('')}</tr></thead><tbody>
      <tr><th scope="row">Caption</th>${d.tables.map((x, i) => `<td><input type="text" data-cap="${i}" value="${esc(d.caps[i])}" aria-label="${esc(name(x))} caption" spellcheck="false"></td>`).join('')}</tr>
      ${t.columns.map(c => `<tr><th scope="row">${esc(c.label)}</th>${d.tables.map((x, i) => `<td><input type="checkbox" data-t="${i}" data-col="${esc(c.id)}" aria-label="${esc(`${c.label} in ${name(x)}`)}"${d.on[i].has(c.id) ? ' checked' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
  el.innerHTML = `<section class="ev-word" aria-label="Word tables">
    ${tableRegion({ label: 'Word tables', sticky: true, html: grid })}
    ${uiBar({ kind: 'foot', label: 'Word tables', id: 'ev-wt-foot', cls: 'ev-word-foot', actions: [{ id: 'ev-wt-cancel', label: 'Cancel', keep: true }, { id: 'ev-wt-save', label: 'Save', role: 'primary' }] })}
  </section>`;
  cueRegions(el);
  el.querySelectorAll('[data-cap]').forEach(i => i.oninput = () => { d.caps[+i.dataset.cap] = i.value; });
  el.querySelectorAll('[data-col]').forEach(b => b.onchange = () => { const on = d.on[+b.dataset.t]; if (b.checked) on.add(b.dataset.col); else on.delete(b.dataset.col); });
  el.querySelector('#ev-wt-cancel').onclick = () => { wordDraft = null; ctx.rerender(); };
  el.querySelector('#ev-wt-save').onclick = () => {
    const order = t.columns.map(c => c.id);
    const saved = d.tables.map((x, i) => {
      const on = d.on[i];
      // Kept columns keep their place; a column ticked now goes after the kept column before it in the template.
      const cols = x.columns.filter(id => on.has(id));
      for (const id of order) if (on.has(id) && !cols.includes(id)) {
        const before = order.slice(0, order.indexOf(id)).reverse().find(b => cols.includes(b));
        cols.splice(before ? cols.indexOf(before) + 1 : 0, 0, id);
      }
      return { ...x, caption: d.caps[i].trim(), columns: cols };
    });
    update(st => { const x = (st.templates || []).find(y => y.id === d.templateId); if (x) x.wordTables = saved; return st; });
    wordDraft = null; ctx.rerender();
  };
  el.querySelector('[data-cap]')?.focus();
}

// ---- into the project folder ---------------------------------------------------------
/**
 * Writes the three exports of each publishable table into the folder: the
 * plan first, shown with every write and move, and nothing written unless
 * the person confirms. Returns a line for the folder view.
 */
export async function writeEvidenceTables(folder) {
  const out = [];
  for (const t of publishable()) out.push(await writeOne(folder, t.id));
  return out.filter(Boolean).join('; ');
}

async function writeOne(folder, templateId) {
  const t = templateOf(templateId);
  const layout = await projectLayout(folder);
  const current = t.published?.file || t.source?.file || '';
  const list = async dir => (await folder.list(dir)).map(e => ({ name: e.name, dir: e.dir }));
  const plan = await evidencePlan({ current, list, archive: layout.archive, dataDir: layout.dirFor('data'), exists: async p => (await folder.stat(p)).exists });
  const model = evidenceModel(get(), templateId);
  const r = nextRound(model, { version: `v${plan.version}` });
  const files = {
    publication: await bytes(await publicationWorkbook(model)),
    sources: await bytes(await sourcesWorkbook(model, { rounds: r.rounds, snapshot: r.snapshot })),
    word: await bytes(await wordDocument(model)),
  };
  // Nothing changed since the files in the folder were written: nothing to write.
  if (!r.round && t.published?.paths?.length) {
    const same = await Promise.all(t.published.paths.map(async p => { try { return await sameParts(await folder.read(p.path), files[p.role]); } catch { return false; } }));
    if (same.every(Boolean)) return `${t.name}: unchanged`;
  }
  const ok = await planDialog({ id: 'write-plan', title: `Write ${t.name} as v${plan.version}`, confirm: 'Write',
    body: `<table class="ask-table"><tbody>${planRows(plan).map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>
        ${plan.problems.length ? `<p class="ev-plan-problem">${plan.problems.map(esc).join('<br>')}</p>` : ''}
        ${r.round && !r.round.first ? `<p class="meta">${r.round.changes.length} cells changed since the last export</p>` : ''}`,
    onMount: d => { if (plan.problems.length) d.querySelector('[type=submit]').disabled = true; } });
  if (!ok) return `${t.name}: not written`;
  const res = await applyEvidencePlan(folder, plan, files, ensureDir);
  // Evidence that cites a file the plan archived follows it.
  moveEvidencePaths(Object.fromEntries(res.done.filter(o => o.op === 'move').map(o => [o.from, o.to])));
  if (res.failed) return `${t.name}: stopped after ${res.done.length} of ${plan.ops.length} steps (${res.failed})`;
  const written = plan.ops.filter(o => o.op === 'write');
  const pub = written.find(o => o.role === 'publication' && o.to.includes('/')) || written.find(o => o.role === 'publication');
  keepRound(templateId, r, { published: { file: pub.to, version: plan.version, at: new Date().toISOString(), paths: written.filter(o => dirOf(o.to) === dirOf(pub.to)).map(o => ({ path: o.to, role: o.role })) } });
  try {
    const log = await outputsLog(folder);
    log[`${plan.dir || layout.dirFor('data')}/Publication tables`] = { label: `${t.name} publication tables`, kind: 'evidence-tables', paths: written.map(o => o.to), version: plan.version, at: new Date().toISOString() };
    await folder.writeText('.lykos/outputs.json', JSON.stringify(log, null, 2));
  } catch { /* the log is a convenience; the files are written */ }
  return `${t.name}: v${plan.version} written (${written.length} files, ${res.done.filter(o => o.op === 'move').length} moved to the archive)`;
}

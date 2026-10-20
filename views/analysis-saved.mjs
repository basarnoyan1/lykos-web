// Saved analyses (DIALOGS #9, #10): every computed result the project keeps (pooled, survival, dataset, advanced, propensity,
// diagnostic, network, from chat), as an item of the Analysis page's list. A row's More has Details (the inspector's Details section
// "Result": its note, warnings, computed fields, inputs and population) and Export (the full record as JSON).
import { get, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { sentenceLabel, disclosure } from '../lib/ui-components.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { showMenu } from '../lib/menu.mjs';
import { saveFile } from '../lib/save.mjs';
import { outcomes, analysisOf, timepointsOf, slotId } from '../lib/outcomes.mjs';
import { researchRecords } from '../lib/research-ledger.mjs';
import { analysisSources } from '../lib/dataset-analysis-core.mjs';
import { analysisRegistry, readAnalysisResult } from '../lib/research-copilot.mjs';
import { resultFields } from './analysis-readiness.mjs';

const SIZE = 25;
let shown = null, page = 1, generation = null;   // the result in Details; the list's page
const sync = () => { if (generation !== projectGeneration()) { generation = projectGeneration(); shown = null; page = 1; } };

/** How many results are saved, counted as the registry lists them but without judging each one current (the list asks on every paint). */
export const savedCount = s => ['datasetAnalyses', 'advancedAnalyses', 'propensityAnalyses'].reduce((n, k) => n + (s[k] || []).length, 0)
  + [s.survival, s.dta, s.nma?.result].filter(Boolean).length + researchRecords(s, { type: 'survival' }).length
  + outcomes(s).reduce((n, o) => n + timepointsOf(s, o.id).filter(t => analysisOf(s, slotId(o.id, t.id))).length, 0);
// A kept dataset analysis is named by its result (Table 1, Logistic regression), not by the method sentence the registry carries.
const rowsOf = s => { const sources = new Map(analysisSources(s).map(d => [d.id, d.name])), kept = new Map((s.datasetAnalyses || []).map(a => [`dataset:${a.id}`, a.result?.title]));
  return analysisRegistry(s).map(r => ({ ...r, title: kept.get(r.id) || r.title, source: sources.get(r.datasetId) || sentenceLabel(r.family) })); };

/** Whether the list offers Saved analyses: anything kept by a page of the project (a result saved from chat alone is listed once something else is). */
export const hasSaved = s => ['datasetAnalyses', 'advancedAnalyses', 'propensityAnalyses'].some(k => (s[k] || []).length) || Boolean(s.survival || s.dta || s.nma?.result)
  || outcomes(s).some(o => timepointsOf(s, o.id).some(t => analysisOf(s, slotId(o.id, t.id))));
export const savedLine = s => plural(savedCount(s), 'analysis', 'analyses');
export function savedPage() {
  return { title: 'Saved analyses', status: { text: savedLine(get()), ch: 16 }, actions: [] };
}

export function renderSaved(el, ctx) {
  sync();
  const rows = rowsOf(get()), view = pageOf(rows, page, SIZE); page = view.page;
  el.innerHTML = uiList({ id: 'an-saved', label: 'Saved analyses', empty: '<p class="meta">No saved analyses yet.</p>',
    rows: view.items.map((r, i) => uiRow({ attrs: { 'data-saved': r.id, ...(r.id === shown ? { 'aria-current': 'true' } : {}) },
      main: { html: esc(r.title), detail: [esc(r.source), esc(sentenceLabel(r.status)), r.n != null ? `n = ${esc(r.n)}` : ''] },
      end: uiRowEnd({ more: { label: `More for ${r.title}`, attrs: { 'data-saved-more': String(i) } } }) })) })
    + pager({ id: 'an-saved-pages', page: view.page, pages: view.pages, total: rows.length, size: SIZE, label: 'analyses' });
  wirePager(el, 'an-saved-pages', next => { page = next; renderSaved(el, ctx); });
  el.querySelectorAll('[data-saved-more]').forEach(b => b.onclick = () => { const r = view.items[Number(b.dataset.savedMore)];
    showMenu(b, [
      { label: 'Details', icon: 'inspector', run: () => { shown = r.id; ctx.rerender(); ctx.openDetails?.(); } },
      { label: 'Export', icon: 'export', run: async () => {
        try { await saveFile(JSON.stringify(readAnalysisResult(get(), { id: r.id, includeScript: true }), null, 2), 'analysis-result.json', 'application/json'); ctx.say?.('Exported'); }
        catch (error) { ctx.say?.(error.message); } } },
    ], { align: 'end' }); });
}

/** Details: the result chosen from a row's More. */
export function savedInspect() {
  sync();
  if (!shown) return [];
  let r; try { r = readAnalysisResult(get(), { id: shown }); } catch { shown = null; return []; }
  return [{ title: 'Result', meta: sentenceLabel(r.status), html: `<p class="meta">${esc(r.note)}</p>
    ${(r.warnings || []).length ? `<ul>${r.warnings.map(w => `<li>${esc(String(w))}</li>`).join('')}</ul>` : ''}
    ${resultFields(r.result)}
    ${disclosure({ title: 'Inputs and analyzed population', body: resultFields({ inputs: r.inputs, options: r.options, population: r.population }) })}` }];
}

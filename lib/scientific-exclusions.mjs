import { esc } from './html.mjs';
import { pageOf, pager, wirePager } from './paging.mjs';
import { tableRegion } from './ui-components.mjs';
import { rerenderForm } from './form-rerender.mjs';

/** A bounded, fully reachable population preview. Patient identity never
 * depends on an attached source report; the report is secondary metadata. */
export function exclusionPreview(excluded, { papers = [], page = 1, size = 20, id = 'analysis-exclusions' } = {}) {
  if (!excluded.length) return '';
  const shown = pageOf(excluded, page, size), reports = new Map(papers.map(p => [p.id, p]));
  const html = `<table class="scientific-exclusions"><thead><tr><th scope="col">Patient</th><th scope="col">Reason</th></tr></thead><tbody>${shown.items.map((x, i) => {
    const p = x.p || x, name = String(p.label || '').trim() || String(p.id || '').trim() || `Patient ${(shown.page - 1) * size + i + 1}`;
    const source = p.study_id && (reports.get(p.study_id)?.label || p.study_id);
    const reason = String(x.why || 'Reason unavailable');
    return `<tr><th scope="row">${esc(name)}${source ? `<div class="meta">Source: ${esc(source)}</div>` : ''}</th><td>${esc(reason[0].toUpperCase() + reason.slice(1))}</td></tr>`;
  }).join('')}</tbody></table>`;
  return `<div id="${esc(id)}">${tableRegion({ label: 'Patients excluded from this analysis', html })}${pager({ id: `${id}-pages`, page: shown.page, pages: shown.pages, total: excluded.length, size, label: 'patients' })}</div>`;
}

export function wireExclusionPreview(root, { id = 'analysis-exclusions', onPage, ctx }) {
  root.querySelector(`#${id}-pages`)?.querySelectorAll('[data-page]').forEach(b => b.setAttribute('data-form-key', `${id}:${b.getAttribute('aria-label')}`));
  wirePager(root, `${id}-pages`, page => { onPage(page); rerenderForm(root, ctx, { fallback: `#${id} [role="region"]` }); });
}

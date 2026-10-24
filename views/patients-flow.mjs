// The PRISMA-IPD flow beside the patient data it counts (plan §3.K, lib/prisma-ipd.mjs):
// the diagram, each count with where it comes from, and the counts only a
// person can give, with the explanation each needs.
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow } from '../lib/ui-actions.mjs';
import { figurePanel, showFigure } from '../lib/figure.mjs';
import { formField } from '../lib/ui-components.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { IPD_FIELDS, HAND_FIELDS, prismaIpdData, deriveIpd, prismaIpdFlow, reconcile, handEntered } from '../lib/prisma-ipd.mjs';

const label = id => IPD_FIELDS.find(f => f.id === id)?.label || id;
const source = (s, id, derived) => {
  const hand = s.prismaIpd?.[id];
  if (hand !== undefined && hand !== '' && hand !== null) return derived[id] === undefined ? 'Entered' : derived[id] === hand ? 'Project' : 'Entered';
  return derived[id] === undefined ? '' : 'Project';
};

/**
 * The panel: a figure, then the counts. Nothing when there are no patients and no decisions to count. The counts are the list of
 * Reporting > Flow: a label, then the number (a field for a count only a person can give, else the project's value in the same box),
 * where it comes from, and the explanation a count entered by hand needs. A row of column names stays at the top while the list scrolls.
 */
export function flowPanel(s) {
  const d = deriveIpd(s);
  if (!(s.participants || []).length && d.screened === undefined) return '';
  return `${figurePanel({ title: 'PRISMA-IPD flow', id: 'ipd-flow' })}
    <div class="panel ipd-flow-counts">
      ${uiBar({ kind: 'head', label: 'Flow counts', id: 'ipd-counts-head', lead: { title: 'Flow counts', level: 'h2' }, message: { id: 'ipd-counts-status', text: ipdStatus(s) } })}
      <div class="panel-body tight">${ipdCounts(s)}</div></div>`;
}
/** How many counts were typed over the project's, and how many of those lack their explanation. */
export const ipdStatus = s => { const hand = handEntered(s); return `${hand.length} entered by hand, ${hand.filter(h => !h.note.trim()).length} without explanation`; };

/**
 * The count rows and the checks they fail, for any page that reports a PRISMA-IPD flow (Patients, and Reporting > Flow for a
 * review whose template is PRISMA-IPD, which passes the project as that review sees it, lib/reviews.mjs scoped).
 */
export function ipdCounts(s) {
  const d = deriveIpd(s);
  const data = prismaIpdData(s), problems = reconcile(data);
  const rowFor = id => {
    const own = HAND_FIELDS.includes(id), src = source(s, id, d), v = data[id];
    const note = (s.prismaNotes || {})[`ipd:${id}`] || '';
    const entered = s.prismaIpd?.[id], typed = entered !== undefined && entered !== '' && entered !== null;
    const required = typed && d[id] !== entered;
    const shown = v === undefined || v === null ? '' : v;
    const row = uiRow({ cls: 'ipd-count', attrs: { 'data-count': id },
      main: { html: `<label class="rp-label"${own ? ` for="ipd-n-${esc(id)}"` : ''}>${esc(label(id))}</label>` },
      cells: [own
        ? { col: 'value', kind: 'control', html: `<span class="rp-box"><input id="ipd-n-${esc(id)}" class="rp-count" data-ipd="${esc(id)}" inputmode="numeric" autocomplete="off" value="${esc(entered ?? '')}" placeholder="${esc(d[id] ?? '')}" aria-label="${esc(label(id))}"></span>` }
        : { col: 'value', kind: 'visual', html: `<span class="rp-box ipd-derived">${esc(shown)}</span>` },
      { col: 'from', kind: 'text', ch: 8, html: esc(src) }] });
    // A count only a person can give carries its explanation on a full-width line beneath it, drawn once the count is typed (as in Reporting > Flow).
    const why = own ? `<div class="rp-why" data-why-for="ipd-${esc(id)}"${typed ? '' : ' hidden'}>${formField('Explanation', `<input data-ipd-why="${esc(id)}" value="${esc(note)}" placeholder="${required ? 'Required' : 'Where this comes from'}" aria-label="Explanation for ${esc(label(id))}"${required ? ` aria-required="true" aria-invalid="${!note.trim()}"` : ''}>`)}</div>` : '';
    return row + why;
  };
  const columns = uiRow({ table: true, cls: 'ipd-colhead', attrs: { role: 'presentation', 'aria-hidden': 'true' }, main: { html: '<span class="ipd-th">Count</span>' },
    cells: [{ col: 'value', kind: 'text', html: '<span class="ipd-th ipd-th-value">Value</span>' }, { col: 'from', kind: 'text', ch: 8, html: '<span class="ipd-th">From</span>' }] });
  return `${uiList({ id: 'ipd-counts', label: 'Flow counts', cols: ['value', 'from'], text: 'short', cls: 'ipd-count-list', rows: [columns, ...IPD_FIELDS.map(f => rowFor(f.id))] })}
        ${problems.length ? `<div class="panel-note">${problems.map(p => `<p class="meta">${esc(p)}</p>`).join('')}</div>` : ''}`;
}

/**
 * Draws the figure (when the page has one) and wires the hand-entered counts. `rerender` redraws the view after a change. `read` gives the
 * project as the flow sees it and `write(st, key, value)` keeps prismaIpd or prismaNotes: Reporting passes one review's (lib/reviews.mjs).
 */
export function wireFlow(el, rerender, { read: readState = get, write = (st, key, value) => { st[key] = value; } } = {}) {
  if (!el.querySelector('#ipd-flow') && !el.querySelector('[data-ipd]')) return;
  const s = readState();
  if (el.querySelector('#ipd-flow')) showFigure(el, 'ipd-flow', prismaIpdFlow(prismaIpdData(s), { style: figureTokens(null, { medium: 'screen' }) }), 'prisma-ipd-flow', { exportSvg: () => prismaIpdFlow(prismaIpdData(readState()), { style: figureTokens(null, { medium: 'export' }) }) });
  const meta = el.querySelector('#ipd-flow-meta');
  if (meta) meta.textContent = `${prismaIpdData(s).analysed_participants ?? 'NA'} patients analysed`;
  const commit = id => {
    const v = el.querySelector(`[data-ipd="${CSS.escape(id)}"]`).value.trim(), why = el.querySelector(`[data-ipd-why="${CSS.escape(id)}"]`).value.trim();
    update(st => {
      const seen = readState === get ? st : readState(), cur = { ...(seen.prismaIpd || {}) }, notes = { ...(seen.prismaNotes || {}) };
      if (v === '' || !Number.isFinite(Number(v))) { delete cur[id]; delete notes[`ipd:${id}`]; } else { cur[id] = Number(v); if (why) notes[`ipd:${id}`] = why; else delete notes[`ipd:${id}`]; }
      write(st, 'prismaIpd', cur); write(st, 'prismaNotes', notes); return st;
    });
    rerender();
  };
  el.querySelectorAll('[data-ipd]').forEach(i => i.onchange = () => commit(i.dataset.ipd));
  el.querySelectorAll('[data-ipd-why]').forEach(i => i.onchange = () => commit(i.dataset.ipdWhy));
}

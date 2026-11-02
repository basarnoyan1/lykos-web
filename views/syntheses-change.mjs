// Syntheses › Change: the change syntheses a project stores a plan for (s.synthesis.change; lib/change-synthesis.mjs, plan §4.15g), listed
// with their pooled numbers and drawn on a press: the forests with their pooled rows and prediction intervals, narrowed to one class or one
// subgroup, the sensitivity forest and the funnel (lib/change-records.mjs changeList, changeFigure). A study in a figure opens its data.
// The list is drawn once per state (changeModel is memoised on the store's version); a press opens the figure in a row under its line.
import { store$get as get } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState, lib_html$sanitizeSvg as sanitizeSvg } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { lib_ui_components$tableRegion as tableRegion } from "../boot.mjs";
import { fitSplit } from '../lib/split-fit.mjs';
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { lib_save$saveFile as saveFile } from "../boot.mjs";
import { changeFigure } from '../lib/change-records.mjs';
import { changeList } from '../lib/change-list.mjs';
import { figureTokens } from '../lib/figure-style.mjs';

const PLOT_W = 220, ROW = 19.5;
let open = null;                 // the code whose figure is open
const groupOf = {};              // the group each figure is narrowed to ('' for all)

/** A plain axis over the shown pools: the null and every interval, widened to whole halves. */
export function axisRange(items) {
  const xs = items.flatMap(x => (x.plot ? [x.plot.lo, x.plot.hi, x.plot.pi_lo, x.plot.pi_hi] : [])).filter(Number.isFinite);
  const lo = Math.floor(2 * Math.min(0, ...xs)) / 2, hi = Math.ceil(2 * Math.max(0, ...xs)) / 2;
  return hi > lo ? [lo, hi] : [-1, 1];
}
const X = ([lo, hi], v, w = PLOT_W) => 2 + (w - 4) * (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
/** One pool on the shared axis: its prediction interval as a hairline, its 95% CI as a line, the estimate as a diamond, the null as the axis's line. */
export function poolPlot(p, range, w = PLOT_W) {
  if (!p) return '';
  const y = ROW / 2, x = v => X(range, v, w);
  return `<svg class="syn-mini" width="${w}" height="${ROW}" viewBox="0 0 ${w} ${ROW}" aria-hidden="true"><line class="syn-mini-null" x1="${x(0)}" y1="0" x2="${x(0)}" y2="${ROW}"/>
    ${p.pi_lo != null ? `<line class="syn-mini-pi" x1="${x(p.pi_lo)}" y1="${y}" x2="${x(p.pi_hi)}" y2="${y}"/>` : ''}<line class="syn-mini-ci" x1="${x(p.lo)}" y1="${y}" x2="${x(p.hi)}" y2="${y}"/>
    <path class="syn-mini-pt" d="M${x(p.est)} ${y - 5}l5 5l-5 5l-5 -5z"/></svg>`;
}
function axisHead(range, w = PLOT_W) {
  // whole numbers when the axis is longer than 3, else halves: at most seven labels, evenly spaced, 0 among them
  const [lo, hi] = range, step = hi - lo > 3 ? 1 : 0.5, shown = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) shown.push(Math.round(v * 10) / 10);
  return `<svg class="syn-mini syn-axis" width="${w}" height="16" viewBox="0 0 ${w} 16" role="img" aria-label="SMCR, ${lo} to ${hi}">${shown.map(v =>
    `<text x="${X(range, v, w)}" y="12" text-anchor="${v === lo ? 'start' : v === hi ? 'end' : 'middle'}">${v === 0 ? '0' : v.toFixed(Number.isInteger(v) ? 0 : 1).replace('-', '−')}</text>`).join('')}</svg>`;
}

function rowHtml(x, range) {
  return `<tr data-change="${esc(x.code)}"><td class="syn-res-title"><button type="button" class="syn-res-pick" data-change-pick="${esc(x.code)}" aria-expanded="${open === x.code}"><span>${esc(x.title)}</span></button></td>
    <td class="syn-res-plot">${x.scale === 'smcr' ? poolPlot(x.plot, range) : ''}</td>
    <td class="syn-res-num"><div>${x.estimate ? `<strong>${esc(x.estimate)}</strong>` : ''}</div>${x.pi ? `<div class="meta">PI ${esc(x.pi)}</div>` : ''}</td>
    <td class="syn-res-k">${esc(x.counts)}</td></tr>`;
}

/** The open figure: its bar (the group it is narrowed to, download, close), the figure, and beside it the numbers behind the line. */
function openHtml(x) {
  const filters = x.groups?.length ? [{ type: 'select', id: 'syn-change-group', label: x.groupLabel || 'Group', options: [['', x.code === 'SUBGROUPS' ? 'Every subgroup' : 'Every group'], ...x.groups.map(g => [g, g])], value: groupOf[x.code] || '' }] : [];
  const details = `<div data-change-side>${sideHtml(x)}</div>`;
  return `<tr class="syn-open"><td colspan="4"><div class="syn-open-in">
    ${uiBar({ kind: 'head', label: x.title, id: 'syn-change-head', lead: { title: x.title, level: 'h3', id: 'syn-change-title' }, filters,
      actions: [{ id: 'syn-change-download', label: 'Download', icon: 'download', menu: true }, { id: 'syn-change-close', label: 'Close', icon: 'close' }] })}
    <div class="syn-open-grid"><div class="syn-open-main"><div class="syn-figure"><div class="chart-svg" data-change-chart><p class="meta">Drawing ${esc(x.title.toLowerCase())}</p></div></div></div>
      <div class="syn-open-side">${details}<h4 class="syn-side-h">Legend</h4><p class="syn-legend">${esc(LEGEND[x.kind === 'funnel' ? 'funnel' : x.code] || LEGEND.forest)}</p></div></div></div></td></tr>`;
}
/** The numbers beside the figure: the group's own pool when the forest is narrowed to one, else the whole synthesis's. */
function sideHtml(x) {
  const g = groupOf[x.code] || '', rows = g && x.levels?.[g] ? x.levels[g] : x.details;
  if (!rows.length) return '';
  return `<h4 class="syn-side-h">${esc(g && x.levels?.[g] ? g : 'Numbers')}</h4><dl class="syn-change-props">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
const LEGEND = {
  forest: 'Squares are each outcome’s estimate with its 95% CI, sized by weight; diamonds are pooled estimates; plain lines are prediction intervals.',
  RESP: 'Each sham arm’s responders with the exact 95% CI; diamonds are GLMM pooled proportions; plain lines are prediction intervals.',
  SENS: 'Each analysis’s pooled sham SMCR (outcomes in trials, CR2 95% CI); the primary analysis is the diamond.',
  SUBGROUPS: 'Each level pooled separately (outcomes in trials, CR2 95% CI), with its trials and outcomes; levels with fewer than three trials are left out.',
  funnel: 'Each outcome’s sham SMCR against its standard error; the line is the pooled estimate with its pseudo 95% limits.',
};

/** The page: the syntheses in their three groups, each line a press that opens its figure. */
export function changeHtml(s = get()) {
  let groups;
  try { groups = changeList(s); }
  catch (err) { return emptyState({ icon: 'warn', title: 'The change syntheses could not be run', detail: String(err?.message || err).slice(0, 200) }); }
  if (!groups.length) return emptyState({ icon: 'matrix', title: 'No change synthesis has rows to pool', detail: 'Check the plan’s table and the sham and active arm patterns in synthesis.change.rows.' });
  const all = groups.flatMap(g => g.items), range = axisRange(all.filter(x => x.scale === 'smcr'));
  const body = groups.map(g => `<tr class="syn-res-group"><th colspan="4" scope="colgroup">${esc(g.group)}</th></tr>${g.items.map(x => rowHtml(x, range) + (open === x.code ? openHtml(x) : '')).join('')}`).join('');
  return `<div class="syn-page syn-change"><section class="syn-sec">${tableRegion({ label: 'Change syntheses', html: `<table class="cl syn-results syn-change-table"><thead><tr><th scope="col" class="syn-c-title">Synthesis</th>
    <th scope="col" class="syn-c-plot">${axisHead(range)}</th><th scope="col">Estimate (95% CI)</th><th scope="col" class="syn-c-n">Data</th></tr></thead><tbody>${body}</tbody></table>` })}</section></div>`;
}

const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'figure';
/** Draws the open figure at the width its box has, and makes each study in it open that study's data. */
async function drawOpen(el, ctx) {
  const box = el.querySelector('[data-change-chart]'); if (!box || !open) return;
  const code = open, w = Math.max(360, Math.round(box.clientWidth || 640));
  const f = await changeFigure(get(), code, { style: figureTokens(null, { medium: 'screen', chart: 'forest' }), group: groupOf[code] || '', width: w });
  if (open !== code || !box.isConnected) return;
  if (f.error) { box.innerHTML = `<p class="meta">${esc(f.error)}</p>`; return; }
  box.innerHTML = sanitizeSvg(f.svg); box.dataset.w = String(w);
  const ids = new Map(f.rows.filter(r => r.paperId).map(r => [r.label, r.paperId]));
  const go = id => ctx.openStudyResults ? ctx.openStudyResults('extraction', id) : document.dispatchEvent(new CustomEvent('lykos:open-study', { detail: { id } }));
  box.querySelectorAll('[data-row]').forEach(mk => { const r = f.rows[Number(mk.getAttribute('data-row'))]; if (!r?.paperId) return;
    mk.classList.add('syn-study-link'); mk.addEventListener('click', () => go(r.paperId)); });
  box.querySelectorAll('svg text').forEach(tx => { const name = String(tx.childNodes?.[0]?.nodeValue ?? tx.textContent).trim(), id = ids.get(name); if (!id) return;
    tx.classList.add('syn-study-link'); tx.setAttribute('role', 'link'); tx.setAttribute('tabindex', '0'); tx.setAttribute('aria-label', `${name}: open its data`);
    tx.addEventListener('click', () => go(id)); tx.addEventListener('keydown', e => { if (e.key === 'Enter') go(id); }); });
}
async function download(kind) {
  const code = open, f = await changeFigure(get(), code, { group: groupOf[code] || '' });
  if (f.error) return;
  const name = slug(f.title);
  if (kind === 'svg') return saveFile(f.svg, `${name}.svg`, 'image/svg+xml');
  if (kind === 'pdf') { const { svgToPdf } = await import('../lib/svg-pdf.mjs'); return saveFile(svgToPdf(f.svg, { title: f.title }), `${name}.pdf`, 'application/pdf'); }
  const { rasterSvg } = await import('../lib/figure-draw.mjs'), r = await rasterSvg(f.svg, { background: 'white', scale: 300 / 96 });
  if (r) await saveFile(new Blob([r.bytes], { type: 'image/png' }), `${name}.png`, 'image/png');
}

/** Draws the page into `el` and wires it; a press opens or closes a figure in place, the rows above it do not move. */
export function renderChange(el, ctx) {
  el.innerHTML = changeHtml();
  const wire = () => {
    el.querySelectorAll('[data-change-pick]').forEach(b => b.onclick = () => { open = open === b.dataset.changePick ? null : b.dataset.changePick; redraw(); });
    el.querySelectorAll('tr[data-change]').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('button, a, input, select')) tr.querySelector('[data-change-pick]')?.click(); }));
    el.querySelector('#syn-change-close')?.addEventListener('click', () => { open = null; redraw(); });
    el.querySelector('#syn-change-group')?.addEventListener('change', e => {
      groupOf[open] = e.target.value; drawOpen(el, ctx);
      const side = el.querySelector('[data-change-side]'), x = changeList(get()).flatMap(g => g.items).find(i => i.code === open);
      if (side && x) side.innerHTML = sideHtml(x);
    });
    const dl = el.querySelector('#syn-change-download');
    if (dl) dl.onclick = () => showMenu(dl, [{ label: 'SVG', icon: 'download', run: () => download('svg') }, { label: 'PDF', icon: 'download', run: () => download('pdf') }, { label: 'PNG, 300 dpi', icon: 'image', run: () => download('png') }], { align: 'end', minWidth: 160 });
    el.querySelectorAll('.syn-open-grid').forEach(g => fitSplit(g, 760));
    const box = el.querySelector('[data-change-chart]');
    if (box) { drawOpen(el, ctx); watchWidth(box, () => { const w = Math.round(box.clientWidth); if (w && box.dataset.w && Math.abs(Number(box.dataset.w) - w) > 24) drawOpen(el, ctx); }); }
  };
  // only the table is drawn again: the page keeps its scroll
  const redraw = () => { const t = el.querySelector('.syn-change-table'); if (!t) { el.innerHTML = changeHtml(); wire(); return; } const y = el.scrollTop; el.innerHTML = changeHtml(); el.scrollTop = y; wire(); };
  wire();
}
/** For tests and the assistant: which figure is open. */
export const openChange = code => { open = code || null; };

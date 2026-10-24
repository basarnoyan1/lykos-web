// Study characteristics (Tables and figures): the included studies as two small figures, publications per year and the studies by one
// charted characteristic, each downloadable as SVG or PNG. They sat on the Overview behind a disclosure; they are figures, so they are
// drawn with the other figures (views/outputs.mjs mounts this and releases it). Nothing is stored here but the choice of view, which is the
// project's own (s.characteristicViews) and which a model suggestion may change when a person accepts it.
import { get, getVersion, update } from '../store.mjs';
import { openStudy } from '../lib/study.mjs';
import { esc, sanitizeSvg } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, uiList, uiRow, watchWidth } from '../lib/ui-actions.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { pagerBar } from '../lib/paging.mjs';
import { showMenu } from '../lib/menu.mjs';
import { studies, screeningStarted } from '../lib/screen.mjs';
import { chartableFields, publicationsByYear, yearOf } from '../lib/charts.mjs';
import { fieldParts } from '../lib/evidence-map.mjs';
import { valueFor } from '../lib/fields.mjs';
import { wireDownload, downloadItems } from '../lib/figure.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { floatingCard, placeCard } from '../lib/chart-card.mjs';
import { detectCharacteristic, selectedVisual, renderCharacteristic, visualEntries, visualNote, visualTitle, entrySourceValues, viewOptions as viewChoices } from '../lib/characteristic-visuals.mjs';

let pointed = null;         // the characteristic last pointed at, for model actions
let chartField = null;      // the characteristic the chart counts by
let chartPage = 0;          // the page of categories that chart shows
const CHART_PAGE = 10;
let release = [];           // what the mounted charts hold: width hooks
let menus = {};             // the Download entries of each mounted figure, by kind: a page of its own offers them from the title bar

// The model action (the title bar's Suggest a visualization) works on the characteristic pointed at, else the one the chart shows.
export const focus = () => pointed || (chartField ? { kind: 'chart', fieldId: chartField } : null);
/** Whether there is anything to draw: screening has begun and some study is included. */
export const hasCharts = s => screeningStarted(s) && studies(s).length > 0;
export function unmount() { release.forEach(r => r()); release = []; menus = {}; pointed = null; }
/** Opens the Download menu of the mounted figure `kind` ('year' or 'field') at `anchor`. */
export function downloadMenu(kind, anchor) { const items = menus[kind]; if (items) showMenu(anchor, items()); }

/** The characteristic the chart shows now ('' before it is drawn): Tables and figures places the chart by it. */
export const shownField = () => chartField || '';
/** Whether some characteristic can be charted for the included studies. */
export const hasFieldChart = s => hasCharts(s) && chartableFields(s, studies(s)).length > 0;
/** The included studies as two small charts: per publication year, and by one charted characteristic. `only` ('year' or 'field') draws that figure alone, on a page of its own. */
export function chartsSection(s, only = '') {
  if (!screeningStarted(s)) return '';
  const inc = studies(s);
  if (!inc.length) return '';
  const opts = chartableFields(s, inc);
  // First choice: the study-design field that holds the most answers (an
  // imported evidence table's column over a sparsely filled built-in one).
  const filled = f => inc.filter(p => valueFor(s, p.id, f)).length;
  const design = opts.filter(x => /design/i.test(x.label)).sort((a, b) => filled(b) - filled(a))[0];
  const f = opts.find(x => x.id === chartField) || design || opts[0];
  chartField = f?.id || null;
  const download = k => ({ id: `chart-dl-${k}`, label: 'Download', icon: 'download', menu: true, attrs: { 'data-chart-dl': k } });
  const profile=f?detectCharacteristic(s,f,inc):null,config=profile?selectedVisual(profile,s.characteristicViews?.[f.id]):null;
  const saved = f ? s.characteristicViews?.[f.id] : null, same = Boolean(saved && profile && saved.signature === profile.signature);
  const viewOptions = profile ? viewChoices(profile) : [];
  // Two cards of one shape: a head (the title and Download), a row of controls (the characteristic and its view as pickers at their
  // content width; the year card's row is empty so the two charts start on one line), the chart, and the chart's source line. The pair's
  // rows are shared (a subgrid), so the cards are as high as each other.
  const n = inc.length, source = what => `${n} included ${n === 1 ? 'study' : 'studies'}; ${what}`;
  // The picker shows the view in use; its menu says which one Automatic resolves to.
  const viewValue = profile ? visualTitle(same ? config.mode : profile.mode) : '';
  return `<section class="chart-section" aria-label="Study characteristics">
    <div class="chart-pair">
      ${only === 'field' ? '' : `<figure class="chart-fig">${only ? '' : uiBar({ kind: 'head', label: 'Publications per year', id: 'chart-year-head', lead: { title: 'Publications per year', level: 'h3' }, actions: [download('year')] })}
        <div class="chart-pick"></div>
        <div class="chart-body"><div class="chart-explore"><div class="chart-svg" data-chart="year"></div><aside class="chart-study-list" hidden aria-label="Studies by publication year"></aside></div></div>
        <figcaption class="meta chart-data-note">${esc(source('Year of publication'))}</figcaption></figure>`}
      ${f && only !== 'year' ? `<figure class="chart-fig">${only ? '' : uiBar({ kind: 'head', label: 'By characteristic', id: 'chart-field-head', lead: { title: 'By characteristic', level: 'h3' }, actions: [download('field')] })}
        <div class="chart-pick">${pickBar(opts, f, viewValue, viewOptions)}</div>
        <div class="chart-body"><div class="chart-explore"><div class="chart-svg" data-chart="field"></div><aside class="chart-study-list" hidden aria-label="Studies by characteristic"></aside></div><div id="chart-field-pager" hidden></div></div>
        <figcaption class="meta chart-data-note" id="chart-data-note" data-source="${esc(source(''))}">${esc(source(visualNote(profile, config)))}</figcaption></figure>` : ''}
    </div></section>`;
}

/** Draws the charts for the width their column has, and again when it changes. */
export function wireCharts(el, ctx) {
  unmount();
  const sec = el.querySelector('.chart-section'); if (!sec) return;
  let characteristicCache=null;
  const profileNow=()=>{const version=getVersion();if(characteristicCache?.version===version&&characteristicCache.field===chartField)return characteristicCache.profile;
    const s=get(),inc=studies(s),f=chartableFields(s,inc).find(x=>x.id===chartField),profile=f?detectCharacteristic(s,f,inc):null;
    const config=profile?selectedVisual(profile,s.characteristicViews?.[f.id]):null;
    characteristicCache={version,field:chartField,profile,config,entries:profile?visualEntries(profile,config):[]};return profile;};
  const configNow=profile=>{profileNow();return characteristicCache.profile===profile?characteristicCache.config:selectedVisual(profile,get().characteristicViews?.[profile.field.id]);};
  const entriesNow=()=>{profileNow();return characteristicCache.entries;};
  // On screen the card's width in px; the file is the print copy on a journal column with the card's caption under it
  // (FIGURE-STYLE §2: one source line feeds both).
  const screen = figureTokens(null, { medium: 'screen' }), print = figureTokens(null, { medium: 'export' });
  const caption = k => sec.querySelector(`[data-chart="${k}"]`)?.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
  const make = (k, width) => {
    const s = get(), inc = studies(s), style = exporting ? print : screen, source = exporting ? [caption(k)] : [];
    if (k === 'year') return publicationsByYear(inc, exporting ? { style, source } : { width, style });
    const f = chartableFields(s, inc).find(x => x.id === chartField);
    if (!f) return '';
    const profile=profileNow(),config=configNow(profile);
    return renderCharacteristic(profile,config,{width:exporting?undefined:width,style,source,title:`Included studies by ${fieldParts(s,profile.field)[0].toLowerCase()}`,max:exporting?Infinity:CHART_PAGE,offset:exporting?0:chartPage*CHART_PAGE,exportNotes:exporting});
  };
  let exporting = false;
  const pagerHost = sec.querySelector('#chart-field-pager');
  const drawPager = () => {
    if (!pagerHost) return;
    const profile=profileNow(),config=profile?configNow(profile):null;
    const total=profile&&config.mode!=='histogram'?visualEntries(profile,config).length:0,pages=Math.ceil(total/CHART_PAGE);
    chartPage = Math.min(chartPage, Math.max(0, pages - 1));
    pagerHost.hidden = pages <= 1;
    if (pages <= 1) return;
    pagerHost.innerHTML = pagerBar({ id: 'chart-field-values', label: 'Pages of values', text: `${chartPage * CHART_PAGE + 1}–${Math.min(total, (chartPage + 1) * CHART_PAGE)} of ${total}`,
      steps: [{ key: 'prev', name: 'Previous values', disabled: !chartPage, attrs: { 'data-chart-page': '-1' } }, { key: 'next', name: 'Next values', disabled: chartPage >= pages - 1, attrs: { 'data-chart-page': '1' } }] });
    pagerHost.querySelectorAll('[data-chart-page]').forEach(b => b.onclick = () => {
      chartPage += Number(b.dataset.chartPage); drawPager();
      const h = sec.querySelector('[data-chart="field"]'); if (h) draw(h, true);
      sec.querySelector('#chart-field')?.scrollIntoView({block:'nearest'});
    });
  };
  const draw = (host, force) => {
    const w = Math.round(host.clientWidth); if (!w || (!force && w === host._w)) return; host._w = w;
    host.innerHTML = sanitizeSvg(make(host.dataset.chart, w));
    // On screen the bars answer with a card, so their built-in tooltips go.
    host.querySelectorAll('[data-chart-mark] > title').forEach(t => t.remove());
    host.querySelectorAll('[data-chart-mark]').forEach(bar => {
      const label = bar.getAttribute('data-chart-mark');
      bar.setAttribute('role', 'button'); bar.setAttribute('tabindex', '0');
      const count = studiesIn(host.dataset.chart, label).length;
      const name=host.dataset.chart==='field'?entriesNow().find(r=>r.key===label)?.label||label:label;
      bar.setAttribute('aria-label', `${name}: show ${count} ${count === 1 ? 'study' : 'studies'}`);
      bar.setAttribute('aria-pressed', String(host._selection === label));
    });
    if (host._card) host._card.hidden = true;
  };
  // Pointing at a bar shows a small card: what it counts, how many, and the
  // first studies in it.
  const studiesIn = (k, label) => {
    const s = get(), inc = studies(s), want = label.toLowerCase();
    if (k === 'year') return inc.filter(p => String(yearOf(p)) === label);
    const profile=profileNow();if(!profile)return [];
    const ids=new Set(entriesNow().find(r=>r.key===label)?.ids||[]);
    return inc.filter(p=>ids.has(p.id));
  };
  sec.querySelectorAll('[data-chart]').forEach(host => {
    const card = host._card = floatingCard();
    const listHost = host.parentElement.querySelector('.chart-study-list');
    let selected = null, page = 0;
    const pageSize = 4;
    const reveal = () => {
      listHost.hidden = selected === null;
      host._selection = selected;
      host.querySelectorAll('[data-chart-mark]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-chart-mark') === selected)));
      if (selected === null) { listHost.innerHTML = ''; return; }
      const list = studiesIn(host.dataset.chart, selected);
      page = Math.min(page, Math.max(0, Math.ceil(list.length / pageSize) - 1));
      const start = page * pageSize;
      const entry=host.dataset.chart==='field'?entriesNow().find(r=>r.key===selected):null,sourceValues=entrySourceValues(entry);
      const kind = host.dataset.chart, count = `${list.length} ${list.length === 1 ? 'study' : 'studies'}`;
      listHost.innerHTML = `${uiBar({ kind: 'head', label: `Studies: ${entry?.label || selected}`, id: `chart-${kind}-list-head`, lead: { title: entry?.label || selected, level: 'h3' }, status: { text: count },
        actions: [{ id: `chart-${kind}-close`, label: 'Close study list', icon: 'close', role: 'quiet', attrs: { 'data-chart-close': '' } }] })}
        ${sourceValues.length ? `<p class="chart-source-values">${sourceValues.map(esc).join('<br>')}</p>` : ''}
        <div class="chart-study-rows${list.length > pageSize ? ' paged' : ''}">${list.length ? uiList({ id: `chart-${kind}-studies`, label: 'Studies', rows: list.slice(start, start + pageSize).map(p => uiRow({
          main: { html: uiLink({ label: p.label || p.title || 'Untitled study', attrs: { 'data-chart-study': p.id } }), detail: p.label && p.title ? [esc(p.title)] : [], wrap: true } })) }) : '<p class="meta">No matching studies</p>'}</div>
        ${list.length > pageSize ? pagerBar({ id: `chart-${kind}-pager`, label: 'Pages of studies', text: `${start + 1}–${Math.min(start + pageSize, list.length)} of ${list.length}`,
          steps: [{ key: 'prev', name: 'Previous studies', disabled: !page, attrs: { 'data-study-page': '-1' } }, { key: 'next', name: 'Next studies', disabled: start + pageSize >= list.length, attrs: { 'data-study-page': '1' } }] }) : ''}`;
      listHost.querySelector('[data-chart-close]').onclick = () => { selected = null; reveal(); host.querySelector('[data-chart-mark]')?.focus({ preventScroll: true }); };
      listHost.querySelectorAll('[data-study-page]').forEach(b => b.onclick = () => {
        const dir = b.dataset.studyPage;
        page += Number(dir); reveal();
        (listHost.querySelector(`[data-study-page="${dir}"]:not(:disabled)`) || listHost.querySelector('[data-study-page]:not(:disabled)'))?.focus({ preventScroll: true });
      });
      listHost.querySelectorAll('[data-chart-study]').forEach(b => b.onclick = () => openStudy(ctx, b.dataset.chartStudy));
    };
    host.addEventListener('pointermove', e => {
      const bar = e.target.closest?.('[data-chart-mark]');
      if (!bar) { card.hidden = true; return; }
      const label = bar.getAttribute('data-chart-mark'), list = studiesIn(host.dataset.chart, label), n = list.length;
      if (label === selected) { card.hidden = true; return; }
      const entry=host.dataset.chart==='field'?entriesNow().find(r=>r.key===label):null;
      card.innerHTML = `<strong>${esc(entry?.label||label)}</strong>${entry?.sources.length?`<span>${esc(entry.sources[0])}</span>`:''}<span class="meta">${n} ${n === 1 ? 'study' : 'studies'}</span>${
        list.slice(0, 4).map(p => `<span>${esc(p.label || p.title || '')}</span>`).join('')}${n > 4 ? `<span class="meta">${n - 4} more</span>` : ''}`;
      card.hidden = false;
      // Beside the bar, never over it; low, against the axis, so it may cover the
      // foot of the next bar but never a bar's top.
      placeCard(card, bar.getBoundingClientRect(), { align: 'bottom' });
    });
    host.addEventListener('pointerleave', () => { card.hidden = true; });
    // Keep the figure visible while browsing the studies that a bar counts.
    const selectBar = e => {
      const bar = e.target.closest?.('[data-chart-mark]'); if (!bar) return;
      const label = bar.getAttribute('data-chart-mark');
      card.hidden = true; selected = label; page = 0; reveal();
    };
    host.addEventListener('click', selectBar);
    host.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBar(e); } });
    host._clearSelection = () => { selected = null; page = 0; reveal(); };
  });
  const hosts = [...sec.querySelectorAll('[data-chart]')];
  hosts.forEach(h => { release.push(watchWidth(h, () => draw(h))); draw(h); });
  drawPager();
  sec.addEventListener('pointerdown',e=>{if(e.target.closest('figure')?.querySelector('#chart-field')){const profile=profileNow();if(profile)pointed={kind:'chart',fieldId:profile.field.id,label:profile.field.label,detail:profile.reason};}});
  const pickHost=sec.querySelector('.chart-pick:has(#chart-tools)');
  const refreshView=()=>{
    const profile=profileNow();if(!profile)return;const config=configNow(profile),saved=get().characteristicViews?.[profile.field.id];
    const options=viewChoices(profile),current=visualTitle(saved?.signature===profile.signature?config.mode:profile.mode);
    const s=get();if(pickHost){pickHost.innerHTML=pickBar(chartableFields(s,studies(s)),profile.field,current,options);wirePickers();}
    const note=sec.querySelector('#chart-data-note');note.textContent=`${note.dataset.source}${visualNote(profile,config)}`;
    drawPager();const h=sec.querySelector('[data-chart="field"]');h?._clearSelection();if(h)draw(h,true);
  };
  // The two pickers: a menu from the bar, the folded form's submenu (the engine sends ui-pick), and the same choice either way.
  const pickField=id=>{chartField=id;chartPage=0;refreshView();};
  const pickView=mode=>{const profile=profileNow();if(!profile)return;
    update(s=>{s.characteristicViews||={};if(mode==='auto')delete s.characteristicViews[profile.field.id];else s.characteristicViews[profile.field.id]={mode,signature:profile.signature};return s;});chartPage=0;refreshView();};
  const optionsOf=id=>{const p=profileNow(),s=get();if(id==='chart-field')return chartableFields(s,studies(s)).map(x=>[x.id,x.label]);
    return p?viewChoices(p):[];};
  function wirePickers(){
    for(const [id,choose,currentOf] of [['chart-field',pickField,()=>chartField],['chart-view',pickView,()=>{const p=profileNow(),saved=p&&get().characteristicViews?.[p.field.id];return saved?.signature===p?.signature?saved.mode:'auto';}]]){
      const b=sec.querySelector(`#${id}`);if(!b)continue;
      b.onclick=()=>showMenu(b,optionsOf(id).map(([value,label])=>({label,checked:value===currentOf(),run:()=>choose(value)})));
      b.addEventListener('ui-pick',e=>choose(e.detail.value));
    }
  }
  wirePickers();
  // The numbers a chart draws, for Data (CSV): a year or a category and its count of studies.
  const countsCsv = k => {
    const s = get(), inc = studies(s);
    if (k === 'year') { const years = inc.map(yearOf).filter(y => y != null), lo = Math.min(...years), hi = Math.max(...years);
      return years.length ? [['Year', 'Studies'], ...Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, years.filter(y => y === lo + i).length])] : []; }
    return [[profileNow()?.field.label || 'Category', 'Studies'], ...entriesNow().map(e => [e.label, e.ids.length])];
  };
  // Exports are drawn on their journal column, whatever the window is.
  for (const k of [...sec.querySelectorAll('[data-chart]')].map(h => h.dataset.chart)) {
    const name = () => k === 'year' ? 'publications-per-year' : `studies-by-${String(chartField || 'field').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const printed = () => { exporting = true; try { return make(k); } finally { exporting = false; } };
    menus[k] = () => downloadItems({ name: name(), svg: printed, data: () => countsCsv(k) });
    wireDownload(sec.querySelector(`[data-chart-dl="${k}"]`), menus[k]);
  }
}
// The characteristic and its view as two pickers in one tools bar; a choice draws the bar again from the builder (its values in slots of
// fixed width, valueCh, so nothing beside them moves).
function pickBar(opts, f, view, viewOptions) {
  const [name, table] = fieldParts(get(), f);
  return uiBar({ kind: 'tools', label: 'Characteristic', id: 'chart-tools',
    // Each declares an icon: in a narrow card the pickers become icon and chevron (the value in the tooltip) before either leaves the row.
    // A table's column shows its own name; the table is said in the tooltip.
    actions: [{ picker: true, id: 'chart-field', label: table ? `Characteristic: ${table}` : 'Characteristic', role: 'quiet', icon: 'table', value: name, valueCh: 20, options: opts.map(x => [x.id, x.label]) },
      { picker: true, id: 'chart-view', label: 'Visualization', role: 'quiet', icon: 'image', value: view, valueCh: 16, options: viewOptions }] });
}
/** Draws the section into `host` and wires it; the caller calls unmount() when the page is left or drawn again. */
export function render(host, ctx, only = '') {
  host.innerHTML = chartsSection(get(), only);
  wireCharts(host, ctx);
}

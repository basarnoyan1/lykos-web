// Display-only detection. Never writes or infers research values.
import { valueFor } from './fields.mjs';
import { splitCategories, barChart, columnChart, histogramBins, NOT_REPORTED } from './charts.mjs';
import { figureTokens } from './figure-style.mjs';
import { hashText } from './prompts.mjs';
import { esc as escXml, r1, svgRoot, text, lines, labelColumn, rowHeight, wrapText, sourceBlock, axisLine, hairLine, tick, measure, GAP, keyLines } from './figure-draw.mjs';

const esc = x => String(x ?? '').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const number = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const unit = '(?:°|%|mm|cm|kg|mg|g|mL|L|months?|mo|years?|yrs?|yr|days?|weeks?)';
const scalar = new RegExp(`^(${number})\\s*(${unit})?$`,'i');
const pair = new RegExp(`^([^0-9]*?)(${number})\\s*(${unit})?\\s*(?:→|->|\\bto\\b)\\s*(${number})\\s*(${unit})?(.*)$`,'i');
const clean = raw => String(raw ?? '').trim().replace(/[−–](?=\d)/g,'-');
const n = x => Number(x.replaceAll(',',''));
const unitOf = x => ({mo:'months',month:'months',yr:'years',yrs:'years',year:'years',day:'days',week:'weeks'}[String(x||'').toLowerCase()] || String(x||'').toLowerCase());
export function missingKind(raw) {
  const x = String(raw ?? '').trim();
  if (/^(?:n\/?a|not applicable)$/i.test(x)) return 'Not applicable';
  if (!x || /^(?:n\/?r|not reported|not found|unknown|missing|[—–-])$/i.test(x)) return NOT_REPORTED;
  return null;
}
export function reportedScalar(raw) {
  const m = clean(raw).match(scalar);
  return m && Number.isFinite(n(m[1])) ? {value:n(m[1]),unit:unitOf(m[2])} : null;
}
export function reportedPair(raw) {
  const m = clean(raw).match(pair); if (!m) return null;
  const firstUnit = unitOf(m[3]), secondUnit = unitOf(m[5]);
  if (firstUnit && secondUnit && firstUnit !== secondUnit) return null;
  // Do not interpret a second outcome, CI, interval or calculation as a qualifier.
  if (/→|->|\bto\b|\bCI\b|[±=]/i.test(m[6])) return null;
  const metric = m[1].trim().replace(/[:=]$/,'').trim() || 'Unspecified measure';
  const first=n(m[2]),second=n(m[4]);
  return Number.isFinite(first)&&Number.isFinite(second) ? {first,second,unit:firstUnit||secondUnit,metric,qualifier:m[6].trim()} : null;
}
const titles = {bars:'Category counts',table:'Source values',pairs:'Paired values',dots:'Value plot',histogram:'Distribution'};
export const visualTitle = mode => titles[mode] || mode;
/** The view picker's menu: Automatic, naming the view it resolves to, then each view the data allow. */
export const viewOptions = profile => [['auto', `Automatic (${visualTitle(profile.mode)})`], ...profile.choices.map(mode => [mode, visualTitle(mode)])];
const rowsOf = (s,f,papers) => papers.map(p=>({id:p.id,label:p.label||p.title||p.id,raw:String(valueFor(s,p.id,f)??'')}));
export const detectCharacteristic=(s,field,papers)=>detectFromRows(field,rowsOf(s,field,papers));
/** The profile of a characteristic from its rows `{ id, label, raw }`. */
export function detectFromRows(field,rows) {
  const present=rows.filter(r=>!missingKind(r.raw));
  const pairs=present.flatMap(r=>splitCategories(r.raw).map(reportedPair).filter(Boolean).map((v,i)=>({...r,...v,key:`pair:${r.id}:${i}`})));
  const numbers=present.map(r=>({...r,...reportedScalar(r.raw)})).filter(r=>Number.isFinite(r.value));
  const categories=new Map();
  for(const r of rows) for(const text of splitCategories(r.raw).length ? splitCategories(r.raw) : [NOT_REPORTED]) {
    const label=missingKind(text)||text,key=label.toLowerCase();
    if(!categories.has(key))categories.set(key,{key,label,ids:new Set(),sources:new Set()});
    const item=categories.get(key);item.ids.add(r.id);item.sources.add(r.raw);
  }
  const groups=[...categories.values()].map(g=>({...g,ids:[...g.ids],sources:[...g.sources]})).sort((a,b)=>(a.label===NOT_REPORTED)-(b.label===NOT_REPORTED)||b.ids.length-a.ids.length||a.label.localeCompare(b.label));
  const choices=['table','bars'];let mode='bars',reason='Reported category counts';
  if(pairs.length) {mode='pairs';choices.splice(0,choices.length,'pairs','table');reason='Explicit reported pairs; measures and units stay separate';}
  else if(field.type!=='category' && numbers.length && numbers.length>=present.length*.8) {
    mode='dots';choices.splice(0,choices.length,'dots','table');if(new Set(numbers.map(r=>r.unit)).size===1)choices.splice(1,0,'histogram');
    reason='Reported numeric values';
  } else if(groups.length>8 || groups.some(g=>g.label.length>65) || present.some(r=>/for all other|placed at|for DXA|in \d+\/\d+/i.test(r.raw))) {
    mode='table';reason='Narrative values are clearer as a table';
  }
  return {field,rows,groups,pairs,numbers,choices,mode,reason,total:rows.length,
    missing:rows.filter(r=>missingKind(r.raw)===NOT_REPORTED).length,
    notApplicable:rows.filter(r=>missingKind(r.raw)==='Not applicable').length,
    signature:hashText(JSON.stringify([field,rows]))};
}
export function validateVisualSuggestion(profile, out) {
  if(!out || !profile.choices.includes(out.mode))throw new Error('The suggested view is not supported by these data.');
  if(out.groups!=null && !Array.isArray(out.groups))throw new Error('Invalid category grouping.');
  const assigned=new Set(), known=new Map(profile.groups.map(g=>[g.key,g]));
  const groups=(out.groups||[]).map(g=>{
    if(!g || typeof g.label!=='string' || !g.label.trim() || g.label.length>100 || !Array.isArray(g.values) || !g.values.length)throw new Error('Invalid category grouping.');
    const values=g.values.map(x=>String(x).toLowerCase());
    for(const k of values) {if(!known.has(k)||assigned.has(k)||missingKind(known.get(k).label))throw new Error('A grouping repeats, invents or reclassifies a missing value.');assigned.add(k);}
    return {label:g.label.trim(),values};
  });
  if(groups.length>30 || (groups.length&&!['bars','table'].includes(out.mode)))throw new Error('Grouping is only available for category counts or source tables.');
  if(new Set(groups.map(g=>g.label.toLowerCase())).size!==groups.length || groups.some(g=>missingKind(g.label)))throw new Error('Group labels must be distinct reported categories.');
  const finalLabels=[...groups.map(g=>g.label.toLowerCase()),...profile.groups.filter(g=>!assigned.has(g.key)).map(g=>g.label.toLowerCase())];
  if(new Set(finalLabels).size!==finalLabels.length)throw new Error('A suggested label duplicates an ungrouped category.');
  return {mode:out.mode,groups,signature:profile.signature,reason:String(out.reason||'').slice(0,240),origin:'model'};
}
export function visualGroups(profile,config={}) {
  if(!config.groups?.length)return profile.groups;
  const groups=validateVisualSuggestion(profile,config).groups,used=new Set(groups.flatMap(g=>g.values));
  return [...groups.map((g,i)=>{
    const source=profile.groups.filter(x=>g.values.includes(x.key));
    return {key:`group:${i}`,label:g.label,ids:[...new Set(source.flatMap(x=>x.ids))],sources:source.map(x=>x.label)};
  }),...profile.groups.filter(g=>!used.has(g.key))];
}
export function selectedVisual(profile,config) {
  if(!config || config.signature!==profile.signature || !profile.choices.includes(config.mode))return {mode:profile.mode};
  try {visualGroups(profile,config);return config;}catch{return {mode:profile.mode};}
}
export function visualEntries(profile,config={}) {
  if(config.mode==='pairs')return profile.pairs.map(r=>({key:r.key,label:`${r.label}: ${r.metric}${r.unit?` (${r.unit})`:''}`,ids:[r.id],sources:[r.raw]}));
  if(config.mode==='dots')return profile.numbers.map(r=>({key:`number:${r.id}`,label:r.label,ids:[r.id],sources:[r.raw]}));
  if(config.mode==='histogram'){const bins=histogramBins(profile.numbers.map(r=>r.value));return bins.map((b,i)=>({key:`bin:${i}`,label:`${b.lo}–${b.hi}`,ids:profile.numbers.filter(r=>r.value>=b.lo&&(i===bins.length-1?r.value<=b.hi:r.value<b.hi)).map(r=>r.id),sources:[]}));}
  return visualGroups(profile,config);
}
export function visualNote(profile,config={}) {
  const mode=config.mode||profile.mode;
  const parsed=mode==='pairs'?new Set(profile.pairs.map(r=>r.id)).size:mode==='dots'||mode==='histogram'?profile.numbers.length:null;
  return [config.origin==='model'?(config.reviewed?'Reviewed AI view':'AI suggested view'):profile.reason,
    parsed!=null?`${parsed} of ${profile.total} studies plotted; ${profile.total-parsed} without a parsed value`:'',
    parsed==null&&profile.missing?`${profile.missing} not reported`:'',
    profile.notApplicable?`${profile.notApplicable} not applicable`:'',
    parsed==null&&profile.rows.some(r=>splitCategories(r.raw).length>1)?'A study can appear in several categories':''].filter(Boolean).join('; ');
}
/** Repeated category values add nothing to a study-list heading. Keep distinct
 * original text for paired values and reviewed groupings. */
export function entrySourceValues(entry) {
  return [...new Set(entry?.sources||[])].filter(value=>String(value).trim().toLowerCase()!==String(entry?.label||'').trim().toLowerCase());
}
// ---- the drawings (FIGURE-STYLE §2): source values and value plots -----------------------------------------------
const mark = key => `data-chart-mark="${escXml(key)}"`;
const tipOf = (label, value) => `<title>${escXml(value == null ? label : `${label}: ${value}`)}</title>`;
const sourceLines = source => [source].flat().filter(Boolean);
/** The foot of a house figure: the source block (source and N, groupings, the label key). Returns the figure's height. */
function houseFoot(t, parts, y, w, items) {
  const all = items.filter(Boolean);
  if (!all.length) return y + t.pad + t.size.label * 0.4;
  const b = sourceBlock(t, t.pad, y + t.size.small * 0.9, w - 2 * t.pad, all);
  parts.push(b.svg);
  return y + t.size.small * 0.9 + b.h + t.pad;
}
const houseEmpty = (t, w, title, source, msg) => {
  const parts = [text(t, t.pad, t.pad + t.size.label, msg, { cls: 'c-mute' })];
  const h = houseFoot(t, parts, t.pad + t.size.label * 1.4, w, sourceLines(source));
  return svgRoot(t, w, h, parts.join(''), { title: title || msg, desc: msg });
};

/** The reported values as a table: each verbatim value, wrapped whole (a table never cuts a value), with its study count. */
function houseTable(entries, t, { width, source = [], title = '' } = {}) {
  const w = width || t.width.double, P = t.pad, sm = t.size.small, gap = t.size.label * GAP;
  if (!entries.length) return houseEmpty(t, w, title, source, 'No values to show');
  const countW = Math.max(measure(t, 'Studies', 'small'), ...entries.map(r => measure(t, String(r.ids.length)))), labelW = w - 2 * P - countW - gap * 2;
  const parts = [text(t, P, P + sm, 'Reported value', { role: 'small', cls: 'c-mute' }), text(t, w - P, P + sm, 'Studies', { anchor: 'end', role: 'small', cls: 'c-mute' })];
  let y = P + sm * 1.6;
  parts.push(hairLine(t, P, y, w - P, y));
  for (const r of entries) {
    const ls = wrapText(t, r.label, labelW), h = rowHeight(t, ls.length), cy = y + h / 2;
    parts.push(`<g ${mark(r.key)}>${tipOf(r.label)}<rect class="c-empty" x="${P}" y="${r1(y)}" width="${r1(w - 2 * P)}" height="${r1(h)}" fill="transparent"/>${lines(t, P, cy, ls)}${text(t, w - P, cy + t.size.label * 0.35, String(r.ids.length), { anchor: 'end' })}</g>`, hairLine(t, P, y + h, w - P, y + h));
    y += h;
  }
  const h = houseFoot(t, parts, y, w, sourceLines(source));
  return svgRoot(t, w, h, parts.join(''), { title, desc: `${entries.length} reported value${entries.length === 1 ? '' : 's'} with the number of studies reporting each` });
}

/**
 * Reported numbers as dots on a shared axis per measure and unit, or as paired values joined by a line (first open,
 * second filled). One baseline with ticks per measure, no gridlines; the label column wraps to two lines or keys.
 */
function housePlot(profile, mode, t, { width, offset = 0, max = 10, source = [] } = {}) {
  const all = mode === 'pairs' ? profile.pairs : profile.numbers, shown = all.slice(offset, offset + max), title = visualTitle(mode);
  const w = width || t.width.single, P = t.pad, L = t.size.label, sm = t.size.small, r = t.dot, gap = L * GAP;
  if (!shown.length) return houseEmpty(t, w, title, source, 'No values to plot');
  // the last tick label is centred on the end of the axis: leave it half its width
  const tickText = v => String(Number(v.toPrecision(3)));
  const spans = [...new Set(shown.map(x => `${mode === 'pairs' ? x.metric : ''}|${x.unit}`))].map(g => {
    const vs = all.filter(x => `${mode === 'pairs' ? x.metric : ''}|${x.unit}` === g).flatMap(x => (mode === 'pairs' ? [x.first, x.second] : [x.value])), lo = Math.min(...vs), hi = Math.max(...vs), pad = lo === hi ? Math.max(1, Math.abs(lo) * 0.05) : (hi - lo) * 0.1;
    return [lo - pad, hi + pad];
  });
  const widestTick = Math.max(0, ...spans.flatMap(([a, b]) => [0, 1, 2, 3, 4].map(i => measure(t, tickText(a + (b - a) * i / 4), 'small'))));
  const col = labelColumn(t, shown.map(x => x.label), w * 0.4), x0 = P + col.w, plotW = Math.max(L * 4, w - x0 - P - Math.max(r + 2, widestTick / 2));
  const key = x => `${mode === 'pairs' ? x.metric : ''}|${x.unit}`, parts = [];
  let y = P, k = 0;
  if (mode === 'pairs') {
    const cy = y + L * 0.7;
    parts.push(`<circle class="c-empty c-point-first" cx="${r1(P + r)}" cy="${r1(cy)}" r="${r}" fill="${t.color.page}" stroke="${t.color.ink}" stroke-width="${t.line.axis}"/>`, text(t, P + r * 2 + gap * 0.6, cy + L * 0.35, 'First', { role: 'small', cls: 'c-mute' }));
    const sx = P + r * 2 + gap * 0.6 + measure(t, 'First', 'small') + gap * 1.6;
    parts.push(`<circle class="c-dot" cx="${r1(sx + r)}" cy="${r1(cy)}" r="${r}" fill="${t.color.ink}"/>`, text(t, sx + r * 2 + gap * 0.6, cy + L * 0.35, 'Second', { role: 'small', cls: 'c-mute' }));
    y += L * 1.9;
  }
  for (const group of [...new Set(shown.map(key))]) {
    const rs = shown.filter(x => key(x) === group), whole = all.filter(x => key(x) === group);
    const values = whole.flatMap(x => (mode === 'pairs' ? [x.first, x.second] : [x.value])), lo = Math.min(...values), hi = Math.max(...values);
    const pad = lo === hi ? Math.max(1, Math.abs(lo) * 0.05) : (hi - lo) * 0.1, min = lo - pad, top = hi + pad, X = v => x0 + (v - min) / (top - min) * plotW;
    const head = wrapText(t, `${mode === 'pairs' ? rs[0].metric : profile.field.label.split(/ · | \(|: /)[0]}${rs[0].unit ? ` (${rs[0].unit})` : ''}`, w - 2 * P);   // lint-allow-dot: reads labels saved before 2026-10-20
    parts.push(lines(t, P, y + rowHeight(t, head.length) / 2, head, { role: 'head', cls: 'c-ink c-head' }));
    y += rowHeight(t, head.length);
    const top0 = y;
    for (const x of rs) {
      const ls = col.lines[k++], h = rowHeight(t, ls.length), cy = y + h / 2, attr = mode === 'pairs' ? x.key : `number:${x.id}`;
      let marks = '';
      if (mode === 'pairs') marks = `<line class="c-axis" x1="${r1(X(x.first))}" y1="${r1(cy)}" x2="${r1(X(x.second))}" y2="${r1(cy)}" stroke="${t.color.axis}" stroke-width="${t.line.ci}"/><circle class="c-empty c-point-first" cx="${r1(X(x.first))}" cy="${r1(cy)}" r="${r}" fill="${t.color.page}" stroke="${t.color.ink}" stroke-width="${t.line.axis}"/><circle class="c-dot" cx="${r1(X(x.second))}" cy="${r1(cy)}" r="${r}" fill="${t.color.ink}"/>`;
      else marks = `<circle class="c-dot" cx="${r1(X(x.value))}" cy="${r1(cy)}" r="${r}" fill="${t.color.ink}"/>`;
      parts.push(`<g ${mark(attr)}>${tipOf(x.label, x.raw)}<rect class="c-empty" x="${P}" y="${r1(y)}" width="${r1(w - 2 * P)}" height="${r1(h)}" fill="transparent"/>${lines(t, P, cy, ls)}${marks}</g>`);
      y += h;
    }
    parts.push(axisLine(t, x0, y, x0 + plotW, y));
    for (let i = 0; i <= 4; i++) {
      const v = min + (top - min) * i / 4, xx = X(v);
      parts.push(tick(t, xx, y), text(t, xx, y + sm * 1.45, tickText(v), { anchor: 'middle', role: 'small', cls: 'c-ink' }));
    }
    y += sm * 1.45 + L * 1.2;
  }
  const h = houseFoot(t, parts, y - L * 0.4, w, [...sourceLines(source), ...keyLines(col.keys)]);
  return svgRoot(t, w, h, parts.join(''), { title, desc: `${shown.length} of ${all.length} ${mode === 'pairs' ? 'paired values' : 'values'}` });
}

function renderView(profile,config={},opts={}) {
  const {width=480,offset=0,max=10,source=[],title=''}=opts,style=opts.style||figureTokens(null,{medium:'export'}),mode=config.mode||profile.mode,entries=visualEntries(profile,{...config,mode});
  // the house figure: its width is the card's on screen, the column's in print
  const house={style,source,title,width:style.medium==='screen'?width:undefined};
  if(mode==='pairs'||mode==='dots')return housePlot(profile,mode,style,{width:house.width,offset,max,source});
  if(mode==='table')return houseTable(entries.slice(offset,offset+max),style,{width:house.width,source,title:`${profile.field.label}: source values`});
  if(mode==='histogram') {
    const bins=histogramBins(profile.numbers.map(r=>r.value)),unit=profile.numbers[0]?.unit||'';
    let chart=columnChart(bins.map(b=>({label:String(b.lo),count:b.count,title:`${b.lo}–${b.hi}`})),{width,xLabel:unit||profile.field.label,yLabel:'Studies',edges:bins.length>1?[...bins.map(b=>b.lo),bins.at(-1).hi]:null,flush:true,...house});
    bins.forEach((b,i)=>{chart=chart.replaceAll(`data-chart-mark="${b.lo}"`,`data-chart-mark="bin:${i}"`);});
    return chart;
  }
  // Render keys as hit targets, while preserving the displayed full category labels.
  let result=barChart(entries.map(g=>({label:g.label,count:g.ids.length})),{width,offset,max,paged:true,flush:true,...house});
  for(const g of entries)result=result.replaceAll(`data-chart-mark="${esc(g.label.charAt(0).toUpperCase()+g.label.slice(1))}"`,`data-chart-mark="${esc(g.key)}"`);
  return result;
}

/**
 * The figure of a characteristic in the house style (FIGURE-STYLE §2). `opts.style` is figureTokens for the medium (the print copy
 * without one); `opts.source` is the caller's source line, which an export (`exportNotes`) writes into the figure's source block
 * with the reviewed groupings; `opts.title` goes to <title>.
 */
export function renderCharacteristic(profile,config={},opts={}) {
  return renderView(profile,config,{...opts,source:opts.exportNotes?[...[opts.source].flat(),...(config.groups||[]).map(g=>`${g.label}: ${g.values.join('; ')}`)]:[]});
}

/** The house drawings app/lint-figures.mjs checks: counts, source values, a value plot, paired values and a distribution of one characteristic each. */
export const __fixture = style => {
  const papers = ['Aldermere 2012', 'Ibarra-Montoya 2019', 'Kowalczyk-Nowak 2016', 'Researcher 2024', 'Lindqvist 2008'].map((label, id) => ({ id: String(id), label }));
  const profileOf = (type, values, label = 'Characteristic') => {
    const field = { id: 'f', label, type };
    const rows = papers.map((p, i) => ({ id: p.id, label: p.label, raw: values[i] }));
    // the detector reads values through fields.mjs; the fixture builds the profile from the rows it would read
    return detectFromRows(field, rows);
  };
  const cases = [
    ['bars', profileOf('category', ['Retrospective cohort study', 'Non-randomized intervention study with historical controls', 'Retrospective cohort study', '', 'Case series; Retrospective cohort study']), {}],
    ['table', profileOf('text', ['Two-stage in 5/25; single stage otherwise, placed at the surgeon’s discretion after the first assessment', 'Single stage', 'Not reported', 'N/A', 'Single stage']), { mode: 'table' }],
    ['dots', profileOf('number', ['41 years', '52 years', '63 years', '58 years', 'unknown'], 'Age'), { mode: 'dots' }],
    ['pairs', profileOf('text', ['Cobb: 42° to 18°', 'Cobb: 55° to 21°', 'SVA: 60 mm to 25 mm', 'Cobb: 48° to 30°', ''], 'Correction'), { mode: 'pairs' }],
    ['histogram', profileOf('number', ['41', '52', '63', '58', '47'], 'Age'), { mode: 'histogram' }],
  ];
  return cases.map(([name, profile, config]) => ({ name, svg: renderCharacteristic(profile, config, { style, source: ['5 included studies'], exportNotes: true }) }));
};

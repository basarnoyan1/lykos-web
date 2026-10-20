// The preview of a table or figure in the list of Tables and figures (views/outputs.mjs): the app's own drawing, by the renderer of the page
// that owns it, small. A figure is its screen copy fitted to the row's preview box (a tall one shows its top at the box's width); a table is
// its shape, never its words cut short: its head and first rows as bars as long as their cells, its columns as wide as their longest cell,
// and its rows × columns under them. An item that is a file only shows its newest printed image (or the shape of its workbook,
// or the first page of its PDF), on paper, dimmed in a dark theme; its row says it is the printed version. Loaded when the first row comes
// into view, with the renderers it needs, so the list is drawn before any of this is read.
import { get } from '../store.mjs';
import { esc, sanitizeSvg } from '../lib/html.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { plural } from '../lib/dates.mjs';

const screen = () => figureTokens(null, { medium: 'screen' });
/** The preview box, in CSS pixels (research-views.css .tf-thumb): every row reserves it before its drawing arrives. */
export const BOX = Object.freeze({ w: 120, h: 75 });
const ROWS = 6, COLS = 6, WIDEST = 24;   // a table's shape: its head and first rows and columns, a cell's bar at most WIDEST characters long
const IMAGE = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'];

// ---- the pieces of a preview -----------------------------------------------------------------------------------------------------------
const words = c => String(c ?? '').replace(/\s+/g, ' ').trim().length;
/**
 * A table's shape: the head and first rows as bars in their columns (a bar as long as its cell's words, a column as wide as its longest),
 * the head's bars heavier and ruled off, and under them its rows × columns (`more` when only the first rows were read).
 */
export function tableHtml(rows, { more = false } = {}) {
  const [head = [], ...body] = (rows || []).filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim()));
  if (!head.length) return '';
  const all = Math.max(head.length, ...body.map(r => r.length)), n = Math.min(COLS, all), shown = [head, ...body.slice(0, ROWS)];
  const widest = Array.from({ length: n }, (_, i) => Math.min(WIDEST, Math.max(4, ...shown.map(r => words(r[i])))));
  const W = BOX.w, GAP = 4, PITCH = 7, unit = (W - GAP * (n + 1)) / widest.reduce((a, b) => a + b, 0);
  const xs = widest.reduce((at, w, i) => [...at, i ? at[i - 1] + widest[i - 1] * unit + GAP : GAP], []);
  const H = 12 + PITCH * Math.max(1, shown.length - 1);
  const bars = shown.map((r, j) => xs.map((x, i) => {
    const l = Math.min(words(r[i]), widest[i]);
    return l ? `<rect class="${j ? 'tf-b' : 'tf-h'}" x="${x.toFixed(1)}" y="${j ? 7 + PITCH * j : 2}" width="${(Math.max(l, 2) * unit).toFixed(1)}" height="3" rx="1.5"/>` : '';
  }).join('')).join('');
  const shape = `<svg class="tf-thumb-shape" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false">${bars}<line class="tf-rule" x1="${GAP}" x2="${W - GAP}" y1="8.5" y2="8.5"/></svg>`;
  // its size as rows × columns (the words in full on hover: the box is too narrow for them)
  const r = `${body.length}${more ? '+' : ''}`;
  return `${shape}<span class="tf-thumb-note" title="${esc(`${more ? `${r} rows` : plural(body.length, 'row')}, ${plural(all, 'column')}`)}">${esc(`${r} × ${all}`)}</span>`;
}
/**
 * A drawing fitted to the box, on the parsed <svg> element: its size from the viewBox (or width and height), the size attributes taken off so
 * CSS sizes it (a size in its style yields to the stylesheet's, .tf-thumb-fig>svg), and a drawing taller than it is wide (a traffic light of 27 studies) shown from its top at the box's width rather than as a
 * sliver. The element, or null when it has no size. Its attributes are set, never its markup edited as text (2026-10-19).
 */
export function fitTree(root) {
  const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number), boxed = vb?.length === 4;
  const w = boxed ? vb[2] : Number.parseFloat(root.getAttribute('width')), h = boxed ? vb[3] : Number.parseFloat(root.getAttribute('height'));
  if (!(w > 0 && h > 0)) return null;
  for (const name of ['width', 'height', 'preserveAspectRatio']) root.removeAttribute(name);
  if (!boxed) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  root.setAttribute('preserveAspectRatio', w / h < 1 ? 'xMidYMin slice' : 'xMidYMid meet');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
  return root;
}
/**
 * What a 120 px thumbnail of a figure keeps: its marks. A figure's <title> and <desc> are tooltips on its marks, which a thumbnail (one press
 * target, its name beside it) has no use for, and they were 20% of the thumbnails' 2,400 elements that every switch into Tables and figures
 * styled and laid out (2026-10-19). Sanitised and stripped in one pass, in the parsed document: never by editing the sanitised markup.
 */
export const thumbMarks = svg => sanitizeSvg(svg, { drop: ['title', 'desc', 'text'] });
/**
 * A figure's thumbnail: sanitised with its words dropped (thumbMarks), then parsed once, fitted to the box (fitTree) and given the theme's
 * tones (lib/figure.mjs themeTree; a house figure is drawn themed), and serialised once. No step edits markup as text.
 */
const figure = (svg, themeTree) => {
  const clean = thumbMarks(svg);
  if (!clean) return '';
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml'), root = doc.documentElement;
  if (doc.querySelector('parsererror') || !root || !fitTree(root)) return '';
  if (themeTree && !root.hasAttribute('data-style')) themeTree(root);
  return `<div class="figure tf-thumb-fig">${new XMLSerializer().serializeToString(root)}</div>`;
};
const note = text => `<span class="tf-thumb-note">${esc(text)}</span>`;

// ---- the app's drawings ------------------------------------------------------------------------------------------------------------------
async function drawn(d, s, folder = null) {
  const { themeTree } = await import('../lib/figure.mjs');
  const fig = svg => ({ kind: 'figure', html: figure(svg, themeTree) });
  const table = (rows, o) => ({ kind: 'table', html: tableHtml(rows, o) });
  if (d.notRun) return { kind: 'not-run', html: note('Not run') };
  if (d.draw === 'prisma') {
    const [pf, pc] = await Promise.all([import('../lib/prisma-flow.mjs'), import('../lib/prisma-counts.mjs')]);
    return fig(pf.prismaFlow(pc.prismaData(s), { previous: false, other: false, ...(s.prismaArms || {}), style: screen() }));
  }
  if (d.draw === 'rob') {
    const [ai, af, schema] = await Promise.all([import('../lib/app-items.mjs'), import('../lib/appraisal-fig.mjs'), import('../schema.mjs')]);
    const set = ai.robSets(s).find(x => x.tool.id === d.tool);
    return set ? fig(af.trafficLight(set.tool, set.done, schema.JUDGEMENT_TONE, { style: screen() })) : { kind: 'none', html: note('No complete assessment') };
  }
  if (d.draw === 'forest') {
    const [oc, fp, hr] = await Promise.all([import('../lib/outcomes.mjs'), import('../lib/forest-page.mjs'), import('../lib/figure-house-render.mjs')]);
    const a = d.run || oc.analysisOf(s, d.slot), data = a ? fp.forestData(a) : null;
    if (data) return fig(fp.forestPageSvg(data, { page: 1, width: 560, style: screen(), het: a.totals === false ? '' : hr.heterogeneityLine(a), weights: a.totals === false ? null : a.weights,
      favours: a.favours?.length === 2 ? a.favours : null }).svg);
    // a result without per-study numbers: R's stored figure
    const { figureFor } = await import('../lib/figures.mjs');
    const svg = a ? await figureFor(a, 'svg').catch(() => '') : '';
    return svg ? fig(svg) : { kind: 'none', html: note('Figure not on this computer') };
  }
  if (d.draw === 'evidence-map') {
    const em = await import('../lib/evidence-map.mjs'), { row, col } = em.mapFields(s);
    return fig(em.evidenceMapSvg(em.evidenceMap(s, row, col), { style: screen(), shade: s.evidenceMap?.shade || '', patients: s.evidenceMap?.patients || '' }));
  }
  if (d.draw === 'summary') {
    const { searchSummary, summaryRows } = await import('../lib/search-summary.mjs');
    const r = summaryRows(searchSummary(s));
    return table([r.head, ...r.body, ...r.foot]);
  }
  if (d.draw === 'sof' || d.draw === 'profile') {
    const { drawApp } = await import('../lib/app-items.mjs');
    const t = drawApp(s, d.draw);
    return t.error ? { kind: 'none', html: note(t.error) } : table(t.rows);
  }
  if (d.draw === 'swim') {
    const [ss, sm] = await Promise.all([import('../lib/swim-state.mjs'), import('../lib/swim.mjs')]);
    const sw = ss.swimOf(s);
    return fig(sm.harvestPlotSvg(ss.swimRows(s), { weight: sw.weight || undefined, style: screen() }));
  }
  if (d.draw === 'swim-events') return table((await (await import('./outputs-paper.mjs')).swimRowsFor(s, d.swim, folder)).flat);
  if (d.draw === 'study') {
    const [sc, ch, cv, fl] = await Promise.all([import('../lib/screen.mjs'), import('../lib/charts.mjs'), import('../lib/characteristic-visuals.mjs'), import('../lib/fields.mjs')]);
    const inc = sc.studies(s), opts = ch.chartableFields(s, inc), filled = f => inc.filter(p => fl.valueFor(s, p.id, f)).length;
    const f = opts.filter(x => /design/i.test(x.label)).sort((a, b) => filled(b) - filled(a))[0] || opts[0];
    if (!f) return { kind: 'none', html: '' };
    const profile = cv.detectCharacteristic(s, f, inc);
    return fig(cv.renderCharacteristic(profile, cv.selectedVisual(profile, s.characteristicViews?.[f.id]), { style: screen(), width: 480 }));
  }
  if (d.spec) {
    const { renderOutput, chartSvg } = await import('../lib/output-render.mjs');
    const m = renderOutput(s, d.spec);
    if (d.spec.kind === 'chart') return m.result.total ? fig(chartSvg(m, { width: 480, page: 12, style: screen() })) : { kind: 'none', html: note('No matching rows') };
    const g = m.groups[0];
    if (!g?.cells?.length) return { kind: 'none', html: note('No matching rows') };
    const flat = v => (Array.isArray(v) ? v.join('; ') : v);
    return table([[...(m.grouped ? [d.spec.groupRowsBy] : []), ...m.columns.map(c => c.label)], ...m.groups.flatMap(gr => gr.cells.map(r => [...(m.grouped ? [gr.label] : []), ...r.map(flat)]))]);
  }
  return { kind: 'none', html: d.link ? note(`Drawn in ${d.viewLabel}`) : '' };
}

// ---- a file only: its newest printed version --------------------------------------------------------------------------------------------
// (a printed comparison is made a comparison of the app and run without being asked: views/outputs.mjs drawPrinted)
async function printed(it, folder) {
  if (!folder) return { kind: 'none', html: '' };
  const files = it.printed.filter(r => r.part !== 'caption').slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const image = files.find(r => IMAGE.some(x => r.paths?.[x]));
  if (image) {
    const ext = IMAGE.find(x => image.paths[x]), bytes = await folder.read(image.paths[ext]);
    if (ext === 'svg') { const html = figure(new TextDecoder().decode(bytes)); if (html) return { kind: 'printed', html }; }
    else {
      const url = URL.createObjectURL(new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }));
      return { kind: 'printed', html: `<img class="tf-thumb-img" src="${esc(url)}" alt="" decoding="async">`, url };
    }
  }
  // a table printed as a workbook or a CSV: its first rows
  const sheet = files.find(r => r.paths?.xlsx || r.paths?.csv);
  if (sheet) {
    let rows = [];
    try {
      if (sheet.paths.xlsx) { const { readXlsx } = await import('../lib/xlsx-read.mjs'); rows = (await readXlsx(await folder.read(sheet.paths.xlsx), { maxRows: 40 })).sheets[0]?.rows || []; }
      else { const { parseDelimited } = await import('../lib/spreadsheet.mjs'); rows = parseDelimited(new TextDecoder().decode(await folder.read(sheet.paths.csv))).rows; }
    } catch { rows = []; }
    const html = tableHtml(rows.slice(0, 40).map(r => (r || []).map(v => (v == null ? '' : String(v)))), { more: rows.length >= 40 });
    if (html) return { kind: 'printed-table', html };
  }
  // a table printed only in a Word document that holds its caption (a supplement): the table under (or over) that caption
  if (it.kind === 'table' && it.label) {
    const docs = it.printed.filter(r => r.part === 'caption' && r.paths?.docx).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    for (const r of docs) {
      try {
        const { parseDocx } = await import('../lib/docx.mjs');
        const blocks = (await parseDocx(await folder.read(r.paths.docx))).blocks, said = new RegExp(`^\\s*${it.label.replace(/\s+/g, '\\s*')}\\b[.:]?`, 'i');
        const at = blocks.findIndex(b => b.type !== 'table' && said.test(String(b.text || '')));
        if (at < 0) continue;
        const near = [...blocks.slice(at + 1, at + 4), ...blocks.slice(Math.max(0, at - 2), at).reverse()].find(b => b.type === 'table' && b.grid?.rows?.length);
        const html = near ? tableHtml(near.grid.rows.map(row => row.cells.map(c => (c.merged ? '' : c.text)))) : '';
        if (html) return { kind: 'printed-table', html };
      } catch { /* a document that does not open has no preview */ }
    }
  }
  // a figure printed as a PDF only: its first page, small
  const pdf = files.find(r => r.paths?.pdf);
  if (pdf && typeof document !== 'undefined') {
    try {
      const { loadPdf } = await import('../lib/anchor.mjs');
      const { doc } = await loadPdf(new Uint8Array(await folder.read(pdf.paths.pdf)));
      try {
        const page = await doc.getPage(1), base = page.getViewport({ scale: 1 }), scale = Math.min(2 * BOX.w / base.width, 2 * BOX.h / base.height);
        const vp = page.getViewport({ scale }), canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        return { kind: 'printed', html: `<img class="tf-thumb-img" src="${canvas.toDataURL('image/png')}" alt="">` };
      } finally { doc.destroy(); }
    } catch { /* a PDF that does not open has no preview */ }
  }
  return { kind: 'none', html: '' };
}

/**
 * The preview of an item (lib/paper-items.mjs) or a saved output (`{ drawn: { spec } }`): `{ kind, html }`, kind 'figure', 'table',
 * 'printed', 'printed-table', 'not-run' or 'none', and `url` the object URL of a printed image (the caller revokes it when the
 * preview is replaced). Never throws: a drawing that fails has an empty preview.
 */
export async function drawPreview(it, { folder = null, s = get() } = {}) {
  try {
    // a comparison not run yet keeps its printed version until Analysis draws it (its line says not run, its end opens Analysis)
    if (it.drawn?.notRun && it.printed?.length && folder) { const got = await printed(it, folder); if (got.kind !== 'none') return got; }
    if (it.drawn) return await drawn(it.drawn, s, folder);
    return await printed(it, folder);
  } catch { return { kind: 'none', html: '' }; }
}

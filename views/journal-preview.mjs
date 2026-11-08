// Read-only publication proof, laid out by a journal style from an addon (lib/addons.mjs journalStyles; the journal-styles addon in
// basarnoyan1/lykos-addons, journals/): the style gives the trim, the columns, the first page and the foot, its stylesheet and its
// open-licence fonts; this view splits the manuscript into its parts, flows the text into the style's columns, keeps tables and
// figures whole on pages of their own, and writes each reference in the style's reference style when the project's library holds it.
// Uses the registered DOCX reading model and its own images; never writes a file or project value.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { documentStripSpec } from '../lib/ui-recipes.mjs';
import { pinchZoom } from '../lib/pinch-zoom.mjs';
import { lib_declarations$titlePage as titlePage, lib_declarations$printable as printable } from "../boot.mjs";
import { journalStyleFor, journalKitFor, loadJournalStyles } from '../lib/addons.mjs';
import { findPreset } from '../lib/journal-presets.mjs';
import { referenceRecord, prepareLibrary } from '../lib/docx-reading.mjs';
import { liveSpecOf, chartForBox } from '../lib/live-figure.mjs';

/** Whether Manuscript › View › Journal is offered: the main manuscript, and a loaded journal style that lays out the target journal
 *  (`journal`, project.journals[0]) or, failing that, the journal profile the registered manuscript was checked against. */
export function journalPreviewAvailable(entry, doc, journal = '') {
  return doc?.key === 'manuscript' && !!journalStyleFor({ journal, profile: entry?.journal?.profile || '' });
}
const runsHtml = b => (b.runs || [{ t: b.text }]).map(r => (r.sup ? `<sup>${esc(r.t)}</sup>` : esc(r.t))).join('');
/** The byline, affiliations (with the notes) and correspondence generated from the author list (plan W9a), each in the place of the
 *  source paragraph it stands for, so a click still finds the Word file's paragraph. */
function listParts(paper, scraped) {
  const blocks = titlePage({ paper }).blocks.slice(1), corr = blocks.findIndex(b => /^Correspondence:/.test(b.text));
  const unit = (b, at) => ({ kind: 'p', text: b.text, html: `<p>${runsHtml(b)}</p>`, block: at?.block ?? '' });
  return { authors: unit(blocks[0], scraped.authors), affiliations: blocks.slice(1, corr < 0 ? undefined : corr).map(b => unit(b, scraped.affiliations[0])),
    correspondence: corr < 0 ? scraped.correspondence : unit(blocks[corr], scraped.correspondence) };
}

/** Split by the source's structural headings, never by generated scientific content. With a `paper` whose author list has anyone in
 *  it, the byline, affiliations and correspondence are the list's; otherwise they are read from the source's front matter. */
export function journalParts(model, paper = null) {
  const units = model.units || [], abs = units.findIndex(u => u.kind === 'heading' && /^Abstract$/i.test(u.text.trim()));
  const intro = units.findIndex(u => u.kind === 'heading' && /^Introduction$/i.test(u.text.trim()));
  if (abs < 0 || intro < abs) throw new Error('The journal preview needs Abstract and Introduction headings in the manuscript.');
  const front = units.slice(0, abs), afterAbs = units.findIndex((u, i) => i > abs && u.kind === 'heading' && /^(Glossary|Introduction)$/i.test(u.text.trim()));
  const glossary = afterAbs >= 0 && /^Glossary$/i.test(units[afterAbs].text.trim()) ? units.slice(afterAbs, intro) : [];
  const scraped = { authors: front.find(u => u.kind === 'p' && !/^Running head:/i.test(u.text)),
    correspondence: front.find(u => /^Correspondence:/i.test(u.text)),
    affiliations: front.filter(u => /^[¹²³⁴⁵]|^\d+\s+\[?Department/.test(u.text)) };
  return { title: model.title || front[0]?.text || '', ...(printable(paper?.authors).length ? listParts(paper, scraped) : scraped),
    abstract: units.slice(abs, afterAbs < 0 ? intro : afterAbs), glossary, body: units.slice(intro) };
}

function cleanNodes(html) {
  const box = document.createElement('div'); box.innerHTML = html;
  box.querySelectorAll('button, .msd-stale').forEach(n => n.remove());
  box.querySelectorAll('*').forEach(n => {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name) || ['contenteditable', 'tabindex', 'style', 'id'].includes(a.name)) n.removeAttribute(a.name);
  });
  return [...box.children];
}
const para = (cls, text) => { const n = document.createElement('p'); n.className = cls; n.textContent = text; return n; };
const frame = () => new Promise(r => requestAnimationFrame(r));

/** The style for the target journal (or the registered manuscript's profile), the addons' styles loaded first when they are not yet. */
async function styleOf(journal, entry) {
  const want = { journal, profile: entry?.journal?.profile || '' };
  return journalStyleFor(want) || (await loadJournalStyles(), journalStyleFor(want));
}
/** The style's trim and margins in CSS px; a margin given as one number is the same on every side. */
function sheetBox(style) {
  const m = style.page.margin, margin = Array.isArray(m) ? [0, 1, 2, 3].map(i => Number(m[i % m.length]) || 0) : Array(4).fill(Number(m) || 48);
  return { width: Number(style.page.width), height: Number(style.page.height), margin };
}
/** The largest a figure is printed: the target journal's preset figure page box (inches, lib/journal-presets.mjs), else the text block. */
function figurePage(journal, page) {
  const box = findPreset(journal)?.figures?.page, inch = 96;
  return box?.w > 0 && box?.h > 0 ? { width: box.w * inch, height: box.h * inch }
    : { width: page.width - page.margin[1] - page.margin[3], height: page.height - page.margin[0] - page.margin[2] };
}
/** The style's stylesheet, once per document, beside its module; answers when it has loaded or failed (the base layout still holds). */
function stylesheetOf(style) {
  if (!style.stylesheet || !style.base) return Promise.resolve();
  const href = new URL(style.stylesheet, style.base).href;
  let link = [...document.querySelectorAll('link[data-journal-styles]')].find(l => l.href === href);
  if (link?.dataset.loaded) return Promise.resolve();
  if (!link) { link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href }); link.dataset.journalStyles = ''; document.head.append(link); }
  return new Promise(resolve => { const done = () => { link.dataset.loaded = '1'; resolve(); }; link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); });
}
/** A page's foot: the style's own, else the journal's name, "Manuscript preview" and the page number. */
function footerOf(style, kit, n) {
  if (typeof style.footer === 'function') return style.footer(kit, { n });
  return `<span><i>${esc(style.label || kit.journal)}</i> &nbsp; | &nbsp; Manuscript preview</span><span>${n}</span><span></span>`;
}
// The headings an abstract is written under, as a label at the start of its paragraph: the profile's own and those journals commonly print.
const ABSTRACT_HEADINGS = ['Background and Objectives', 'Background', 'Objectives?', 'Purpose', 'Aims?', 'Introduction', 'Importance', 'Context',
  'Study Design', 'Summary of Background Data', 'Design', 'Setting', 'Participants', 'Patients', 'Interventions?', 'Materials and Methods',
  'Patients and Methods', 'Methods', 'Main Outcomes? and Measures?', 'Results', 'Findings', 'Observations', 'Lessons', 'Conclusions?',
  'Interpretation', 'Discussion', 'Clinical Relevance', 'Level of Evidence', 'Trial Registration(?: Information)?', 'Case Description', 'Case Presentation'];
function abstractLabels(profile) {
  const own = (profile?.abstractHeadings || []).map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^((?:<[^>]+>)*)(${[...own, ...ABSTRACT_HEADINGS].join('|')})[:.]\\s*(?:</[^>]+>)?`, 'i');
}
/**
 * The reference list in the style's reference style (AMA or Vancouver): each entry the project's library holds (by DOI, PMID or title,
 * lib/docx-reading.mjs referenceRecord) is written again from its record; an entry the library does not hold keeps the manuscript's text.
 */
function styleReferences(rows, style, kit, model, papers) {
  const how = ['ama', 'vancouver'].includes(style.references) ? style.references : null;
  if (!how || !papers?.length || !model?.refs?.size) return;
  const lib = prepareLibrary(papers, { exact: true }), byId = new Map(papers.map(p => [p.id ?? p.key, p]));
  for (const row of rows) {
    const num = row.querySelector('.msd-ref-n'), key = num ? num.textContent.replace(/\.$/, '') : '';
    const entry = key && model.refs.get(key), id = entry ? referenceRecord(entry, lib) : null, p = id != null ? byId.get(id) : null;
    const text = p ? kit[how](p) : '';
    if (!text) continue;
    row.replaceChildren(...(num ? [num] : []), document.createTextNode(text)); row.dataset.styled = how;
  }
}

/** Returns immediately so a navigation away cancels loading/pagination and revokes every object URL. */
export function mountJournalPreview(host, { load, folder, entry, doc, paper = null, journal = '', papers = null, style = null }) {
  let disposed = false, urls = [], zoom = 'page', current = 0, pages = [], resize = null, unpinch = null, scrollFrame = 0, label = 'Journal';
  const alive = () => !disposed && host.isConnected;
  host.classList.add('nj-viewer');
  host.innerHTML = `<div class="nj-navigation"></div><div class="nj-scroll" tabindex="0" aria-label="Read-only journal preview"><div class="nj-pages"><p class="nj-loading">Preparing journal pages…</p></div></div>`;
  const viewport = host.querySelector('.nj-scroll'), stack = host.querySelector('.nj-pages');
  const q = id => host.querySelector(`#nj-${id}`);
  const fitLabel = () => zoom === 'fit' ? 'Fit width' : zoom === 'page' ? 'Fit page' : Number(zoom) === 1 ? 'Actual size' : 'Custom';
  const zoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  let scaleShown = 1;
  const syncControls = () => {
    if (!q('page')) return;
    if (document.activeElement !== q('page')) q('page').value = String(current + 1);
    q('prev').disabled = current === 0;
    q('next').disabled = current >= pages.length - 1;
    q('zoom-level').textContent = `${Math.round(scaleShown * 100)}%`;
    q('zoom-out').disabled = scaleShown <= zoomSteps[0];
    q('zoom-in').disabled = scaleShown >= zoomSteps.at(-1);
    q('fit').querySelector('.ui-picker-value').textContent = fitLabel();
    q('fit').setAttribute('aria-label', `Fit: ${fitLabel()}`);
  };
  const controls = stale => {
    const spec = documentStripSpec({ id: 'nj', label: 'Journal preview navigation', page: current + 1, pages: pages.length, zoom: '100%', fit: ['page', fitLabel()] });
    spec.message = { id: 'nj-status', text: `${label} preview${stale ? ', source changed' : ''}` };
    host.querySelector('.nj-navigation').innerHTML = uiBar(spec);
    q('prev').onclick = () => go(current - 1);
    q('next').onclick = () => go(current + 1);
    q('page').onchange = e => go(Number(e.target.value) - 1);
    q('page').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(Number(e.target.value) - 1); e.target.blur(); } };
    const step = direction => {
      zoom = String(direction > 0 ? zoomSteps.find(z => z > scaleShown + 0.01) || zoomSteps.at(-1) : [...zoomSteps].reverse().find(z => z < scaleShown - 0.01) || zoomSteps[0]);
      fit(); go(current);
    };
    q('zoom-out').onclick = () => step(-1);
    q('zoom-in').onclick = () => step(1);
    q('fit').addEventListener('ui-pick', e => {
      const mode = e.detail?.value;
      if (!['width', 'page', 'actual'].includes(mode)) return;
      zoom = mode === 'width' ? 'fit' : mode === 'actual' ? '1' : 'page'; fit(); go(current);
    });
    syncControls();
  };
  const go = i => {
    current = Math.max(0, Math.min(pages.length - 1, Math.round(Number(i) || 0)));
    viewport.scrollTop = (pages[current]?.wrap.offsetTop || 0) - (pages[0]?.wrap.offsetTop || 0);
    scaleShown = pages[current]?.scale || 1; syncControls();
  };
  const fit = () => {
    if (!alive()) return;
    const padding = getComputedStyle(stack);
    const width = Math.max(120, viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
    const height = Math.max(120, viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom));
    for (const p of pages) {
      const { wrap, sheet, pageWidth, pageHeight } = p;
      const scale = zoom === 'fit' ? Math.min(1.5, width / pageWidth) : zoom === 'page' ? Math.min(width / pageWidth, height / pageHeight) : Number(zoom);
      p.scale = scale;
      wrap.style.setProperty('--nj-page-width', `${pageWidth * scale}px`); wrap.style.setProperty('--nj-page-height', `${pageHeight * scale}px`); sheet.style.transform = `scale(${scale})`;
    }
    scaleShown = pages[current]?.scale || 1; syncControls();
  };
  viewport.addEventListener('scroll', () => { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(() => {
    let at = 0; pages.forEach((p, i) => { if (p.wrap.offsetTop <= viewport.scrollTop + viewport.clientHeight / 3) at = i; });
    if (current !== at) { current = at; scaleShown = pages[current]?.scale || 1; syncControls(); }
  }); }, { passive: true });
  viewport.addEventListener('keydown', e => { if (e.target !== viewport) return; if (['ArrowRight', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); go(current + (e.key === 'ArrowRight' ? 1 : -1)); } });

  const ready = (async () => {
    try {
      const r = await load(); if (!alive()) return;
      if (r.error) throw new Error(r.error);
      const sty = style || await styleOf(journal, entry);
      if (!sty) throw new Error(`no journal style lays out ${journal || entry?.journal?.profile || 'this journal'}.`);
      label = sty.label || 'Journal'; viewport.setAttribute('aria-label', `Read-only ${label} preview`);
      const parts = journalParts(r.model, paper), media = new Map((r.d.media || []).map(m => [m.id, m]));
      const kit = journalKitFor({ style: sty, parts, journal, version: entry?.version || '' });
      const page = sheetBox(sty), columns = Math.max(1, Math.min(3, Number(sty.columns) || 2));
      const figureBox = figurePage(journal, page);
      await stylesheetOf(sty); if (!alive()) return;
      // a face that does not load leaves its fallback (the style's stack ends in a system serif or sans): the pages are still laid out
      await Promise.allSettled((sty.fonts || []).map(f => document.fonts.load(f)));
      await document.fonts.ready;
      if (!alive()) return;
      stack.replaceChildren();
      const makePage = (kind = 'body', landscape = false) => {
        const wrap = document.createElement('div'); wrap.className = 'nj-page-wrap';
        const sheet = document.createElement('article'); sheet.className = `nj-sheet nj-${kind}${landscape ? ' nj-landscape' : ''}`; sheet.lang = 'en'; sheet.setAttribute('aria-label', `Page ${pages.length + 1}`);
        sheet.dataset.journalStyle = sty.id; if (sty.family) sheet.dataset.journalFamily = sty.family;
        const pageWidth = landscape ? page.height : page.width, pageHeight = landscape ? page.width : page.height;
        for (const [k, v] of [['w', pageWidth], ['h', pageHeight], ['mt', page.margin[0]], ['mr', page.margin[1]], ['mb', page.margin[2]], ['ml', page.margin[3]], ['content-h', pageHeight - page.margin[0] - page.margin[2]]])
          sheet.style.setProperty(`--nj-${k}`, `${v}px`);
        // the journal's own measured values (faces, sizes, leading, accent) as --nj-* properties its stylesheet and the base sheet read
        for (const [k, v] of Object.entries(sty.vars || {})) if (/^[a-z][a-z0-9-]*$/.test(k)) sheet.style.setProperty(`--nj-${k}`, String(v));
        sheet.innerHTML = `<div class="nj-paper-content"></div><footer class="nj-footer">${footerOf(sty, kit, pages.length + 1)}</footer>`;
        wrap.append(sheet); stack.append(wrap);
        const p = { wrap, sheet, content: sheet.firstElementChild, pageWidth, pageHeight }; pages.push(p); return p;
      };
      const nodesOf = u => cleanNodes(u.html).map(n => { n.dataset.sourceBlock = String(u.block); return n; });
      const resolveImages = async nodes => {
        await Promise.all(nodes.flatMap(n => [...n.querySelectorAll('img')]).map(async img => {
          try {
            const m = media.get(img.dataset.media), path = img.dataset.file;
            const bytes = m?.bytes || (path && await folder.read(path));
            if (!bytes) throw new Error('missing');
            if (!alive()) return;
            const url = URL.createObjectURL(new Blob([bytes], { type: m?.mime || (/\.svg$/i.test(path || '') ? 'image/svg+xml' : /\.jpe?g$/i.test(path || '') ? 'image/jpeg' : 'image/png') }));
            urls.push(url); img.src = url;
            await img.decode();
          } catch { img.replaceWith(para('nj-missing', `${img.alt || 'Figure'}: image unavailable in this manuscript version.`)); }
        }));
      };
      // First page: the style's own (title, byline, abstract and their slots); the affiliations at its foot unless the style places them.
      const first = makePage('first');
      first.content.innerHTML = sty.first(kit);
      const slot = name => first.content.querySelector(`[data-slot="${name}"]`);
      if (parts.authors && slot('authors')) slot('authors').append(...nodesOf(parts.authors));
      if (parts.correspondence && slot('correspondence')) slot('correspondence').append(...nodesOf(parts.correspondence));
      if (parts.affiliations.length) {
        const a = slot('affiliations') || first.sheet.appendChild(Object.assign(document.createElement('div'), { className: 'nj-affiliations' }));
        parts.affiliations.forEach(u => a.append(...nodesOf(u)));
      }
      let column = slot('abstract');
      if (!column) throw new Error(`the ${label} style has no place for the abstract.`);
      column.classList.add('nj-abstract');
      const labels = abstractLabels(kit.profile);
      const newAbstract = () => {
        const p = makePage('abstract-page'), h = document.createElement('h2'); h.textContent = 'Abstract (continued)'; p.content.append(h);
        column = document.createElement('div'); column.className = 'nj-abstract'; p.content.append(column);
        column.style.height = `${p.content.getBoundingClientRect().bottom - column.getBoundingClientRect().top}px`; return column;
      };
      // a layout that heads the abstract itself (.nj-abstract-head) does not repeat the manuscript's own Abstract heading
      const ownHead = !!first.content.querySelector('.nj-abstract-head');
      for (const u of parts.abstract.filter((x, i) => !(ownHead && i === 0 && x.kind === 'heading'))) for (const node of nodesOf(u)) {
        if (node.tagName === 'P') node.innerHTML = node.innerHTML.replace(labels, (m, open, name) => `<strong class="nj-abstract-label">${name}</strong>`);
        column.append(node);
      }
      // The abstract grows below a variable-length title; it ends above the page's foot and above the affiliations placed there.
      const foot = first.sheet.querySelector(':scope > .nj-affiliations');
      const limit = Math.min(first.content.getBoundingClientRect().bottom, foot ? foot.getBoundingClientRect().top - 12 : Infinity);
      column.style.height = `${Math.max(120, limit - column.getBoundingClientRect().top - 8)}px`;
      const abstractNodes = [...column.children]; column.replaceChildren();
      for (const node of abstractNodes) await flow(node, () => column, () => newAbstract(), alive);
      if (!alive()) return;
      let bodyPage = null, side = 0;
      const nextColumn = () => {
        if (bodyPage && side < columns - 1) { side++; return bodyPage.cols[side]; }
        bodyPage = makePage(); side = 0;
        if (!pages.some(p => p.glossary) && parts.glossary.length) { const g = document.createElement('div'); g.className = 'nj-glossary'; parts.glossary.forEach(u => g.append(...nodesOf(u))); bodyPage.content.append(g); bodyPage.glossary = true; }
        const cols = document.createElement('div'); cols.className = 'nj-columns'; cols.style.setProperty('--nj-columns', String(columns));
        cols.innerHTML = '<div class="nj-column"></div>'.repeat(columns); bodyPage.content.append(cols); bodyPage.cols = [...cols.children];
        return bodyPage.cols[0];
      };
      column = nextColumn();
      // Tables/figures have full-width pages. Body text remains in two columns with intact inline citations.
      const bodyNodes = parts.body.flatMap(nodesOf);
      // a figure whose caption names a Lykos chart is that chart drawn at the journal's figure size, not the file's picture (lib/live-figure.mjs)
      const charts = new Map(), empty = new Set();
      for (const fig of bodyNodes) {
        if (!fig.matches('figure[data-place]')) continue;
        const live = liveSpecOf(r, fig.dataset.place), drawn = live && chartForBox(live, figureBox);
        if (drawn) { fig.querySelector('img')?.remove(); fig.insertAdjacentHTML('afterbegin', `<div class="nj-chart" data-chart="${esc(live.id)}">${drawn.svg}</div>`); charts.set(fig, live); }
        else if (!fig.querySelector('img')) empty.add(fig);   // a legend's figure with neither a chart nor a picture: its legend stands alone
      }
      if (empty.size) bodyNodes.splice(0, bodyNodes.length, ...bodyNodes.filter(n => !empty.has(n)));
      await resolveImages(bodyNodes); if (!alive()) return;
      for (let i = 0; i < bodyNodes.length; i++) {
        if (!alive()) return;
        const node = bodyNodes[i];
        if (node.matches('.msd-refs')) { const rows = [...node.children]; styleReferences(rows, sty, kit, r.model, papers); bodyNodes.splice(i, 1, ...rows); i--; continue; }
        if (node.matches('figure, .msd-table') || (node.matches('.msd-cap') && bodyNodes[i + 1]?.matches('.msd-table'))) {
          const display = [node];
          // A source heading for the display belongs with it, not at the bottom of the preceding column.
          const headings = [];
          while (column?.lastElementChild?.matches('h2,h3,h4')) { const h = column.lastElementChild; h.remove(); headings.unshift(h); }
          display.unshift(...headings);
          if (node.matches('.msd-cap') && bodyNodes[i + 1]?.matches('.msd-table')) display.push(bodyNodes[++i]);
          if (node.matches('figure') && bodyNodes[i + 1]?.matches('.msd-cap')) display.push(bodyNodes[++i]);
          while (bodyNodes[i + 1]?.matches('.msd-note')) display.push(bodyNodes[++i]);
          if (display.some(n => n.matches('.msd-table'))) await tablePages(display, makePage, alive);
          else {
            const p = makePage('display'), box = document.createElement('div'); box.className = 'nj-display-content'; p.content.append(box); box.append(...display);
            const img = box.querySelector('img'), chart = box.querySelector('.nj-chart');
            if (chart) {
              // sized to the page box: the figure's width at most, and the height the page leaves under the legend (the chart drawn again for that box)
              const live = charts.get(node), svg = chart.firstElementChild, extra = box.scrollHeight - (svg?.getBoundingClientRect().height || 0);
              const fit = { width: Math.min(figureBox.width, p.content.clientWidth), height: Math.max(120, Math.min(figureBox.height, p.content.clientHeight - extra - 12)) };
              const again = live && chartForBox(live, fit);
              if (again) chart.innerHTML = again.svg;
              box.style.setProperty('--nj-figure-w', `${fit.width}px`);
              chart.style.setProperty('--nj-figure-h', `${fit.height}px`);
            }
            if (img) {
              img.removeAttribute('width'); img.removeAttribute('height');
              const extra = box.scrollHeight - img.getBoundingClientRect().height;
              // no larger than the journal prints a figure (its preset's figure page box), nor than the page's text block
              img.style.maxHeight = `${Math.max(120, Math.min(figureBox.height, p.content.clientHeight - extra - 12))}px`;
              box.style.setProperty('--nj-figure-w', `${Math.min(figureBox.width, p.content.clientWidth)}px`);
            }
            if (box.scrollHeight > p.content.clientHeight + 1) throw new Error('A figure and its caption need more space than a journal page.');
          }
          bodyPage = null; column = null;
          continue;
        }
        if (!column) column = nextColumn();
        // Do not strand a heading at the foot of a column.
        if (/^H[1-6]$/.test(node.tagName) && column.clientHeight - (column.lastElementChild?.getBoundingClientRect().bottom - column.getBoundingClientRect().top || 0) < 85 && column.children.length) column = nextColumn();
        await flow(node, () => column, () => (column = nextColumn()), alive);
        if (i % 12 === 0) await frame();
      }
      if (!alive()) return;
      controls(r.stale?.flags?.record); resize = watchWidth(viewport, fit, { rows: true }); fit(); host.dataset.ready = 'true';
      // a trackpad pinch (or Control and the wheel) zooms as the zoom buttons do, the page under the fingers kept under them (owner, 6 Nov 2026)
      unpinch = pinchZoom(viewport, { live: true, units: '.nj-page-wrap', min: zoomSteps[0], max: zoomSteps.at(-1), get: () => scaleShown, set: next => { zoom = String(next); fit(); } });
    } catch (error) { if (alive()) stack.replaceChildren(para('nj-error', `Preview unavailable: ${error.message}`)); }
  })();
  return { ready, release() { disposed = true; resize?.(); unpinch?.(); cancelAnimationFrame(scrollFrame); urls.forEach(u => URL.revokeObjectURL(u)); urls = []; } };
}

/** Fill a column, splitting only text paragraphs at word boundaries and retaining every inline run. */
async function flow(node, getColumn, advance, alive) {
  let column = getColumn();
  column.append(node);
  if (column.scrollHeight <= column.clientHeight + 1) return;
  node.remove();
  if (/^H[1-6]$/.test(node.tagName)) { advance().append(node); return; }
  const text = node.textContent || '', words = [...text.matchAll(/\s+/g)].map(m => m.index + m[0].length);
  if (!words.length || !node.matches('p, div')) { advance().append(node); return; }
  // Range fragments retain superscripts, italics, hyperlinks and non-ASCII text.
  const fragment = (start, end) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), texts = []; let n, at = 0;
    while ((n = walker.nextNode())) { texts.push({ n, start: at, end: at + n.length }); at += n.length; }
    const a = texts.find(t => start <= t.end), b = texts.find(t => end <= t.end) || texts.at(-1);
    const clone = node.cloneNode(false); if (!a || !b) return clone;
    const range = document.createRange(); range.setStart(a.n, start - a.start); range.setEnd(b.n, end - b.start); clone.append(range.cloneContents()); return clone;
  };
  let lo = 0, hi = words.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, candidate = fragment(0, words[mid]); column.append(candidate); const fits = column.scrollHeight <= column.clientHeight + 1; candidate.remove(); if (fits) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  const lineCount = el => {
    column.append(el);
    const range = document.createRange(); range.selectNodeContents(el);
    const tops = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.top / 3));
    const count = new Set(tops).size; el.remove(); return count;
  };
  // Keep at least two lines of a split paragraph on either side of the break.
  while (best >= 0 && lineCount(fragment(words[best], text.length)) < 2) best--;
  if (best >= 0 && lineCount(fragment(0, words[best])) < 2) best = -1;
  if (best < 0) {
    if (!column.children.length) { column.append(node); throw new Error('A source block is too large for a journal column.'); }
    advance(); return flow(node, getColumn, advance, alive);
  }
  const lead = fragment(0, words[best]); lead.classList.add('nj-split-end'); column.append(lead);
  const rest = fragment(words[best], text.length); rest.classList.remove('nj-split-end'); if (!rest.textContent) return;
  advance(); await frame(); if (alive()) await flow(rest, getColumn, advance, alive);
}

/** Keep every source cell at a readable size; repeat the header when rows continue on another page. */
async function tablePages(nodes, makePage, alive) {
  const source = nodes.find(n => n.matches('.msd-table')), table = source.querySelector('table');
  if (!table) return;
  const rows = [...table.tBodies].flatMap(b => [...b.rows]);
  const header = table.tHead?.cloneNode(true);
  const count = Math.max(...[...table.rows].map(r => [...r.cells].reduce((n, c) => n + c.colSpan, 0)));
  const landscape = count > 8;
  // Text-heavy columns get more room; numeric columns keep a useful minimum. All cells wrap.
  const weights = Array.from({ length: count }, (_, i) => {
    const lengths = [...table.rows].map(r => (r.cells[i]?.textContent || '').length);
    return Math.max(6, Math.min(15, Math.sqrt(Math.max(...lengths, 1))));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const captions = nodes.filter(n => n.matches('.msd-cap') || /^H[1-6]$/.test(n.tagName));
  const notes = nodes.filter(n => n !== source && !captions.includes(n));
  let page, box, body, continued = false;
  const next = () => {
    page = makePage('display', landscape);
    box = document.createElement('div'); box.className = 'nj-display-content'; page.content.append(box);
    captions.forEach(n => box.append(n.cloneNode(true)));
    if (continued) box.append(para('nj-table-continuation', 'Continued'));
    const t = table.cloneNode(false); t.removeAttribute('width');
    const cols = document.createElement('colgroup');
    weights.forEach(w => { const c = document.createElement('col'); c.style.setProperty('--nj-column-width', `${100 * w / total}%`); cols.append(c); });
    t.append(cols); if (header) t.append(header.cloneNode(true));
    body = document.createElement('tbody'); t.append(body); box.append(t); continued = true;
  };
  next();
  for (const row of rows) {
    if (!alive()) return;
    body.append(row);
    if (box.offsetHeight > page.content.clientHeight) {
      row.remove();
      if (!body.rows.length) throw new Error('A table row is taller than a journal page.');
      next(); body.append(row);
      if (box.offsetHeight > page.content.clientHeight) throw new Error('A table row is taller than a journal page.');
    }
  }
  // Notes may continue at readable size, instead of reducing the entire table to a thumbnail.
  let noteColumn = document.createElement('div'); noteColumn.className = 'nj-table-note'; box.append(noteColumn);
  const available = page.content.clientHeight - (noteColumn.getBoundingClientRect().top - page.content.getBoundingClientRect().top);
  noteColumn.style.height = `${Math.max(0, available)}px`;
  const nextNotes = () => {
    page = makePage('display', landscape);
    captions.forEach(n => page.content.append(n.cloneNode(true)));
    page.content.append(para('nj-table-continuation', 'Table notes (continued)'));
    noteColumn = document.createElement('div'); noteColumn.className = 'nj-table-note'; page.content.append(noteColumn);
    noteColumn.style.height = `${page.content.clientHeight - (noteColumn.getBoundingClientRect().top - page.content.getBoundingClientRect().top)}px`;
    return noteColumn;
  };
  for (const note of notes) await flow(note, () => noteColumn, nextNotes, alive);
}

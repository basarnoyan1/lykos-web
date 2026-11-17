// Read-only publication proof, laid out by a journal style from an addon (lib/addons.mjs journalStyles; the journal-styles addon in
// basarnoyan1/lykos-addons, journals/): the style gives the trim, the columns, the first page and the foot, its stylesheet and its
// open-licence fonts; this view splits the manuscript into its parts, flows the text into the style's columns, keeps tables and
// figures whole on pages of their own (a table as the style's `table` declares, lib/journal-table.mjs, when it declares one), and prints each
// reference as the manuscript has it: a record of the project's library sets one again in the style's reference style only where it says what the
// manuscript's entry says (lib/journal-text.mjs sameReference), and no rule for running text touches a reference list.
// A style may also declare how its journal makes up a page, and only then is anything of it done (10 Nov 2026, The Lancet journals): `mirror` (facing pages: the
// outer margin to the right of an odd page and to the left of an even one, the sheet marked data-side), `header(kit, { n, kind, side })` (a head on every page;
// `footer` is told the same), `panelAt: 'page-top'` (its panels across the text block at the head of the page after the first), `floats: 'page-top'` (a figure or
// table at the head of the page after its first mention, the text going on under it when it leaves room; one never mentioned follows the text), `backFrom`
// (the headings the end matter begins at: marked .nj-back from there on) and `referenceMarks` ({ journal: 'italic', volume: 'bold' }). A chart is drawn with
// the style's `decimalMark`, as the text is. `balanceLast` (11 Nov 2026): the columns of the page the text ends on are set to one length (balanceColumns).
// Panels (11 Nov 2026): `panelLabel: 'Panel'` makes a section headed "Panel: …" or "Panel 2: …" a panel, set after the block that first cites it ("(panel)",
// "panel 2"; where the manuscript has it when the text never does), and `panelWhole` keeps every panel whole while it fits, where the journal sets one: at
// the head of the next column when that holds it, the text going on in the column it left, else across the text block at the head of the next page; it is
// cut only when it is longer than a page. A style that declares neither has its panels as before. A chart its style carries over pages in place of setting it smaller (the style's `figure.continues`,
// lib/journal-charts.mjs journalForestParts) stands a part to a page, the last with the legend.
// Uses the registered DOCX reading model and its own images; never writes a file or project value.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { documentStripSpec } from '../lib/ui-recipes.mjs';
import { pinchZoom } from '../lib/pinch-zoom.mjs';
import { lib_declarations$titlePage as titlePage, lib_declarations$printable as printable } from "../boot.mjs";
import { journalStyleFor, journalKitFor, loadJournalStyles } from '../lib/addons.mjs';
import { findPreset } from '../lib/journal-presets.mjs';
import { referenceRecord, referenceKey, prepareLibrary } from '../lib/docx-reading.mjs';
import { liveSpecOf, chartForBox } from '../lib/live-figure.mjs';
import { journalText, panelSpans, panelMention, relabelCorrespondence, decimalMarks, referenceUnits, referenceSpans, sameReference } from '../lib/journal-text.mjs';
import { drawnForStyle } from '../lib/journal-figure.mjs';
import { lib_html$sanitizeSvg as sanitizeSvg } from "../boot.mjs";
import { profileById, partNames, headingKey } from '../lib/journal-profiles.mjs';
import { tableRules, bodyMarks, headMarks, valueLike, leadLength, numberColumn, titleLabel } from '../lib/journal-table.mjs';

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

/** Split by the source's structural headings, never by generated scientific content: the abstract under its heading, the main text from the
 *  section it opens with, and a glossary or a panel that stands between the two under a heading of its own. `names` are the headings they are
 *  found by (lib/journal-profiles.mjs partNames: the journal profile's own beside the usual ones, so The Lancet Neurology's "Summary" is its
 *  abstract and its "Research in context" panel is not). A panel before the opening section leads the body, where the style sets it in its box.
 *  With a `paper` whose author list has anyone in it, the byline, affiliations and correspondence are the list's; otherwise they are read
 *  from the source's front matter. */
export function journalParts(model, paper = null, names = partNames()) {
  const units = model.units || [], named = (u, list) => u.kind === 'heading' && list.some(n => headingKey(n) === headingKey(u.text));
  const abs = units.findIndex(u => named(u, names.abstract)), intro = units.findIndex(u => named(u, [names.opening]));
  if (abs < 0 || intro < abs) throw new Error(`The journal preview needs ${names.abstract[0]} and ${names.opening} headings in the manuscript.`);
  // each heading between the two that opens a part of its own, with what runs to the next of them
  const marks = units.flatMap((u, i) => (i > abs && i < intro && named(u, [names.glossary, ...names.panels]) ? [i] : []));
  const stretch = k => units.slice(marks[k], marks[k + 1] ?? intro), g = marks.findIndex(i => named(units[i], [names.glossary]));
  const front = units.slice(0, abs), glossary = g < 0 ? [] : stretch(g), lead = marks.flatMap((i, k) => (k === g ? [] : stretch(k)));
  const scraped = { authors: front.find(u => u.kind === 'p' && !/^Running head:/i.test(u.text)),
    correspondence: front.find(u => /^Correspondence:/i.test(u.text)),
    affiliations: front.filter(u => /^[¹²³⁴⁵]|^\d+\s+\[?Department/.test(u.text)),
    keywords: [...front, ...units.slice(abs + 1, intro)].find(u => u.kind === 'p' && /^Keywords?\s*:/i.test(u.text.trim())) };
  return { title: model.title || front[0]?.text || '', keywords: scraped.keywords, ...(printable(paper?.authors).length ? listParts(paper, scraped) : scraped),
    abstract: units.slice(abs, marks[0] ?? intro), glossary, body: [...lead, ...units.slice(intro)] };
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
/** The names of an authors line, each followed by an empty ORCID mark: a name and the superscript after it end at a comma or "and" outside the superscript. */
function withOrcid(html) {
  const mark = '<span class="nj-orcid" aria-hidden="true"></span>', sup = [];
  const bare = html.replace(/<sup>.*?<\/sup>/g, m => `\u0001${sup.push(m) - 1}\u0001`);
  const parts = bare.split(/(,\s*|\s+and\s+|\s*&amp;\s*)/);
  return parts.map((t, i) => i % 2 || !t.replace(/\u0001\d+\u0001/g, '').trim() ? t : t.replace(/(\s*)$/, `${mark}$1`)).join('').replace(/\u0001(\d+)\u0001/g, (m, n) => sup[+n]);
}
/** A page's foot: the style's own, else the journal's name, "Manuscript preview" and the page number. */
function footerOf(style, kit, n, more = {}) {
  if (typeof style.footer === 'function') return style.footer(kit, { n, ...more });
  return `<span><i>${esc(style.label || kit.journal)}</i> &nbsp; | &nbsp; Manuscript preview</span><span>${n}</span><span></span>`;
}
// The headings an abstract is written under, as a label at the start of its paragraph: the profile's own and those journals commonly print.
const ABSTRACT_HEADINGS = ['Background and Objectives', 'Background', 'Objectives?', 'Purpose', 'Aims?', 'Introduction', 'Importance', 'Context',
  'Study Design', 'Summary of Background Data', 'Design', 'Setting', 'Participants', 'Patients', 'Interventions?', 'Materials and Methods',
  'Patients and Methods', 'Methods', 'Main Outcomes? and Measures?', 'Results', 'Findings', 'Observations', 'Lessons', 'Conclusions?',
  'Interpretation', 'Discussion', 'Clinical Relevance', 'Level of Evidence', 'Trial Registration(?: Information)?', 'Case Description', 'Case Presentation'];
function abstractLabels(profile) {
  const own = (profile?.abstractHeadings || []).map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // with the space after it, which a Word file keeps inside the bold run ("Background: ") and typed text after it: the label is followed by one
  return new RegExp(`^((?:<[^>]+>)*)(${[...own, ...ABSTRACT_HEADINGS].join('|')})[:.]\\s*(?:</[^>]+>)?\\s*`, 'i');
}
/**
 * The reference list in the style's reference style (AMA, Vancouver or the Lancet's): an entry the project's library holds (by DOI, PMID or title,
 * lib/docx-reading.mjs referenceRecord) is written again from its record only when the record says what the manuscript's entry says and the two
 * differ in form alone (lib/journal-text.mjs sameReference). Every other entry keeps the manuscript's text, letter for letter: a record often
 * names the journal in full, has the title in the capitals of its source, or lacks an initial, and the preview cannot tell which is right (the
 * sham review's v8.5, 11 Nov 2026: references 9, 10 and 28 of 30 came out as their records had them, "Movement disorders: official journal of
 * the Movement Disorder Society" for the manuscript's "Mov Disord", a title in title case, "Finkelstein D" for "Finkelstein DI", "690–9" for "690–99").
 */
function styleReferences(rows, style, kit, model, papers) {
  const how = ['ama', 'vancouver', 'lancet'].includes(style.references) && typeof kit[style.references] === 'function' ? style.references : null;
  if (!how || !papers?.length || !model?.refs?.size) return;
  const lib = prepareLibrary(papers, { exact: true }), byId = new Map(papers.map(p => [p.id ?? p.key, p]));
  for (const row of rows) {
    const num = row.querySelector('.msd-ref-n'), key = num ? referenceKey(num.textContent) : '';
    const entry = key && model.refs.get(key), id = entry ? referenceRecord(entry, lib) : null, p = id != null ? byId.get(id) : null;
    const text = p ? kit[how](p) : '';
    if (!text || !sameReference(entry.text, text)) continue;
    row.replaceChildren(...(num ? [num] : []), document.createTextNode(text)); row.dataset.styled = how;
  }
}

/**
 * A reference of a journal article with the journal's name and the volume marked as its style declares (`referenceMarks`: { journal: 'italic',
 * volume: 'bold' }, The Lancet's "J Headache Pain 2022; 23: 34" with the name in italic and "23:" in bold). The marks go around the stretches
 * lib/journal-text.mjs referenceSpans finds, so every character of the entry stays where the manuscript has it; an entry it does not surely read
 * (a book, a report, another form, markup of its own) stays as it is.
 */
function markReference(row, marks) {
  const num = row.querySelector('.msd-ref-n'), rest = [...row.childNodes].filter(n => n !== num);
  if (!rest.length || rest.some(n => n.nodeType !== 3)) return;
  const text = rest.map(n => n.textContent).join(''), at = referenceSpans(text);
  if (!at) return;
  const cuts = [[...at.journal, marks.journal === 'italic' ? 'i' : ''], ...at.volume.map(v => [...v, marks.volume === 'bold' ? 'b' : ''])].filter(c => c[2]);
  const out = []; let from = 0;
  for (const [a, b, tag] of cuts) { out.push(text.slice(from, a), Object.assign(document.createElement(tag), { textContent: text.slice(a, b) })); from = b; }
  row.replaceChildren(...(num ? [num] : []), ...out.filter(x => x !== ''), text.slice(from));
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
      // the parts by the names the style's journal profile gives them (its abstract's heading, its opening section, its panels)
      const names = partNames(sty.profile ? profileById(sty.profile) : null, sty.panels);
      const parts = journalParts(r.model, paper, names), media = new Map((r.d.media || []).map(m => [m.id, m]));
      // a journal that prints the correspondence under its own label (`correspondenceLabel`: "Correspondence to:")
      if (sty.correspondenceLabel) parts.correspondence = relabelCorrespondence(parts.correspondence, sty.correspondenceLabel);
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
        // a style whose journal prints facing pages (`mirror`): the outer margin is to the right of an odd page and to the left of an even one
        const n = pages.length + 1, verso = !!sty.mirror && n % 2 === 0;
        if (sty.mirror) sheet.dataset.side = verso ? 'verso' : 'recto';
        for (const [k, v] of [['w', pageWidth], ['h', pageHeight], ['mt', page.margin[0]], ['mr', page.margin[verso ? 3 : 1]], ['mb', page.margin[2]], ['ml', page.margin[verso ? 1 : 3]], ['content-h', pageHeight - page.margin[0] - page.margin[2]]])
          sheet.style.setProperty(`--nj-${k}`, `${v}px`);
        // the journal's own measured values (faces, sizes, leading, accent) as --nj-* properties its stylesheet and the base sheet read
        for (const [k, v] of Object.entries(sty.vars || {})) if (/^[a-z][a-z0-9-]*$/.test(k)) sheet.style.setProperty(`--nj-${k}`, String(v));
        sheet.innerHTML = `<div class="nj-paper-content"></div><footer class="nj-footer">${footerOf(sty, kit, n, { kind, side: sheet.dataset.side || '' })}</footer>`;
        // the head a journal prints on every page (the style's `header`: its section label, a rule)
        if (typeof sty.header === 'function') sheet.insertAdjacentHTML('beforeend', `<header class="nj-header">${sty.header(kit, { n, kind, side: sheet.dataset.side || '' })}</header>`);
        wrap.append(sheet); stack.append(wrap);
        const p = { wrap, sheet, content: sheet.firstElementChild, pageWidth, pageHeight }; pages.push(p); return p;
      };
      // a page made to try a table on and not kept (a table that turns out to need a turned page): always the last one made
      const dropPage = p => { const i = pages.indexOf(p); if (i >= 0) pages.splice(i, 1); p.wrap.remove(); };
      // the text as the style's journal prints it (citations after the mark, mid-line decimals: lib/journal-text.mjs); the manuscript's own text is not changed
      const nodesOf = (u, typeset = false) => cleanNodes(typeset ? journalText(u, sty) : u.html).map(n => { n.dataset.sourceBlock = String(u.block); return n; });
      // a figure file drawn for this style (the style's `figure`, lib/journal-flow.mjs) is set into the page, where the style's own face is loaded
      // (a picture that stands alone sees no font of the page), and is sized as a chart is; any other picture, and every style without a `figure`, is as before
      const ownFigure = (img, bytes) => {
        const svg = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
        if (!drawnForStyle(svg, sty)) return false;
        const box = document.createElement('div'); box.className = 'nj-chart'; box.dataset.figureFile = img.dataset.file; box.innerHTML = sanitizeSvg(svg);
        if (!box.querySelector('svg')) return false;
        img.replaceWith(box); return true;
      };
      const resolveImages = async nodes => {
        await Promise.all(nodes.flatMap(n => [...n.querySelectorAll('img')]).map(async img => {
          try {
            const m = media.get(img.dataset.media), path = img.dataset.file;
            const bytes = m?.bytes || (path && await folder.read(path));
            if (!bytes) throw new Error('missing');
            if (!alive()) return;
            if (sty.figure && !m && /\.svg$/i.test(path || '') && ownFigure(img, bytes)) return;
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
      // an ORCID mark after each author (the style's stylesheet draws it, or nothing): the names are split at commas and "and" outside superscripts
      slot('authors')?.querySelectorAll('p').forEach(p => { p.innerHTML = withOrcid(p.innerHTML); });
      if (parts.correspondence && slot('correspondence')) slot('correspondence').append(...nodesOf(parts.correspondence));
      // a style whose journal prints the correspondence as an asterisk footnote (`correspondenceAt: 'foot'`) puts it at the page's foot
      if (parts.correspondence && !slot('correspondence') && sty.correspondenceAt === 'foot') {
        const text = parts.correspondence.text.replace(/^Correspondence(?: to)?:\s*/i, ''), mail = text.match(/[^\s,;()<>]+@[^\s,;()<>]+/)?.[0] || '';
        const rest = text.replace(mail, '').replace(/[\s,;()]+$/, '').replace(/^[\s,;]+/, '');
        const foot = first.sheet.appendChild(Object.assign(document.createElement('div'), { className: 'nj-affiliations nj-footnote' }));
        foot.innerHTML = `<p>* Corresponding author.${rest ? ` ${esc(rest)}.` : ''}</p>${mail ? `<p><i>E-mail address:</i> ${esc(mail)}</p>` : ''}`;
      }
      if (parts.keywords && slot('keywords')) {
        const words = parts.keywords.text.replace(/^Keywords?\s*:\s*/i, '').split(/[;,]\s*/).filter(Boolean);
        slot('keywords').innerHTML = `<p class="nj-keywords-label">Keywords:</p>${words.map(w => `<p>${w.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>`).join('')}`;
      }
      // a style whose journal prints the affiliations at the article's end (`affiliationsAt: 'end'`) leaves only a pointer on the first page
      const atEnd = sty.affiliationsAt === 'end' && parts.affiliations.length && !slot('affiliations');
      if (atEnd && slot('authors')) slot('authors').insertAdjacentHTML('afterend', `<p class="nj-affil-note">${esc(sty.affiliationsNote || '')}</p>`);
      if (parts.affiliations.length && !atEnd) {
        const a = slot('affiliations') || first.sheet.appendChild(Object.assign(document.createElement('div'), { className: 'nj-affiliations' }));
        parts.affiliations.forEach(u => a.append(...nodesOf(u)));
      }
      let column = slot('abstract');
      if (!column) throw new Error(`the ${label} style has no place for the abstract.`);
      column.classList.add('nj-abstract');
      const labels = abstractLabels(kit.profile);
      const newAbstract = () => {
        const p = makePage('abstract-page'), h = document.createElement('h2'); h.textContent = `${names.abstract[0]} (continued)`; p.content.append(h);
        column = document.createElement('div'); column.className = 'nj-abstract'; p.content.append(column);
        column.style.height = `${p.content.getBoundingClientRect().bottom - column.getBoundingClientRect().top}px`; return column;
      };
      // a layout that heads the abstract itself (.nj-abstract-head) does not repeat the manuscript's own Abstract heading
      const ownHead = !!first.content.querySelector('.nj-abstract-head');
      for (const u of parts.abstract.filter((x, i) => !(ownHead && i === 0 && x.kind === 'heading'))) for (const node of nodesOf(u, true)) {
        if (node.tagName === 'P') node.innerHTML = node.innerHTML.replace(labels, (m, open, name) => `<strong class="nj-abstract-label">${name}</strong> `);
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
      // what a style has set at the head of a page: its panels across the text block (`panelAt: 'page-top'`), and the figures and tables whose first
      // mention has been set (`floats: 'page-top'`), the text going on under one that leaves it room. `requeue` goes back into the columns.
      const tops = [], due = [], floats = [], late = [], requeue = [];
      let setFloat = () => null;
      // A style whose journal never cuts a panel that fits (`panelWhole`) has it whole at the head of the page whatever it leaves under it: the text goes on
      // under it where that is room for a few lines, else the page is the panel's (`full`); only a panel longer than the page goes back to the columns, to
      // be cut there. Any other style keeps the panel at the head of a page that it leaves 160 px of, as before.
      const setTop = (box, p, before = null) => {
        box.classList.add('nj-page-top'); p.content.insertBefore(box, before);
        const room = p.content.clientHeight - box.offsetHeight;
        if (sty.panelWhole ? room < 0 : room < 160) { box.classList.remove('nj-page-top'); box.remove(); if (sty.panelWhole) box.dataset.cut = 'true'; requeue.push(box); }
        else if (sty.panelWhole && room < 96) p.full = true;
      };
      // The panels such a style keeps whole stand where the journal sets one: at the head of a column, the text before it filling the column it left. Each
      // waits (`held`) for the next column and goes to its head when the column holds it whole; one the column does not hold (a panel longer than a
      // column, a column under a figure or a table) goes across the text block at the head of the next page, as the style's own panel does.
      const held = [];
      const holds = (col, box) => { col.append(box); if (col.scrollHeight <= col.clientHeight + 1) return true; box.remove(); return false; };
      const settle = col => { for (const box of held.splice(0)) if (!holds(col, box)) tops.push(box); return col; };
      const nextColumn = () => {
        if (bodyPage && bodyPage.cols && side < columns - 1) { side++; return settle(bodyPage.cols[side]); }
        const onFirstPage = bodyPage === first && !first.cols;
        let top = null, hosted = null;
        // (a panel found by the style's label lets the figures and tables that are due have their pages: it stands under one of them where the page holds
        // both, else at the head of the first page none of them is due for, so a figure is not left for a page after the text)
        const after = !onFirstPage && tops.length && !!tops[0].dataset.labelled && due.length > 0;
        if (!onFirstPage && tops.length && !after) top = tops.shift();
        else while (!onFirstPage && !hosted && due.length) hosted = setFloat(due.shift());
        bodyPage = onFirstPage ? first : hosted || makePage(); side = 0;
        if (after && !hosted) top = tops.shift();
        if (top) setTop(top, bodyPage);
        else if (after && hosted) {
          const box = tops[0]; box.classList.add('nj-page-top'); bodyPage.content.append(box);
          const room = bodyPage.content.clientHeight - (box.getBoundingClientRect().bottom - bodyPage.content.getBoundingClientRect().top) / (bodyPage.content.getBoundingClientRect().height / bodyPage.content.offsetHeight || 1);
          if (room < 0) { box.classList.remove('nj-page-top'); box.remove(); } else { tops.shift(); if (room < 96) bodyPage.full = true; }
        }
        if (bodyPage.full) return nextColumn();   // a page its panel fills: the text goes on on the next
        if (!pages.some(p => p.glossary) && parts.glossary.length) { const g = document.createElement('div'); g.className = 'nj-glossary'; parts.glossary.forEach(u => g.append(...nodesOf(u, true))); bodyPage.content.append(g); bodyPage.glossary = true; }
        const cols = document.createElement('div'); cols.className = 'nj-columns'; cols.style.setProperty('--nj-columns', String(columns));
        cols.innerHTML = '<div class="nj-column"></div>'.repeat(columns); bodyPage.content.append(cols); if (bodyPage.footRoom) cols.style.setProperty("--nj-foot", `${bodyPage.footRoom}px`); bodyPage.cols = [...cols.children];
        return settle(bodyPage.cols[0]);
      };
      // An abstract that fits the first page leaves the rest of it to the body, in columns under the abstract, as the journals print it.
      const onFirst = column === slot('abstract');
      if (onFirst) {
        column.style.height = '';
        const room = (foot ? foot.getBoundingClientRect().top - 10 : first.content.getBoundingClientRect().bottom) - column.getBoundingClientRect().bottom;
        if (room > 160) { bodyPage = first; side = columns; first.cols = null; first.footRoom = foot ? Math.max(0, first.content.getBoundingClientRect().bottom - foot.getBoundingClientRect().top + 10) : 0; }
      }
      column = nextColumn();
      // Tables/figures have full-width pages. Body text remains in two columns with intact inline citations.
      // (a reference list the manuscript types as paragraphs is set as written, as one a reference manager writes is: no decimal point of it is moved)
      const typed = referenceUnits(parts.body), bodyNodes = parts.body.flatMap(u => nodesOf(u, !typed.has(u)));
      // a figure whose caption names a Lykos chart is that chart drawn at the journal's figure size, not the file's picture (lib/live-figure.mjs)
      const charts = new Map(), empty = new Set();
      // a chart's labels with the decimal point the journal prints (the style's `decimalMark`), as the text has it
      const marked = svg => (sty.decimalMark ? decimalMarks(svg, sty.decimalMark) : svg);
      // a style that declares how its journal draws a chart (its `figure.chart`) has the chart drawn so (lib/journal-charts.mjs, loaded for such a style only)
      const journalLook = sty.figure?.chart ? (await import('../lib/journal-charts.mjs')).journalCharts(sty) : null; if (!alive()) return;
      for (const fig of bodyNodes) {
        if (!fig.matches('figure[data-place]')) continue;
        const live = liveSpecOf(r, fig.dataset.place), drawn = live && chartForBox(live, figureBox, journalLook);
        if (drawn) { fig.querySelector('img')?.remove(); fig.insertAdjacentHTML('afterbegin', `<div class="nj-chart" data-chart="${esc(live.id)}">${marked(drawn.svg)}</div>`); charts.set(fig, live); }
        else if (!fig.querySelector('img')) empty.add(fig);   // a legend's figure with neither a chart nor a picture: its legend stands alone
      }
      if (empty.size) bodyNodes.splice(0, bodyNodes.length, ...bodyNodes.filter(n => !empty.has(n)));
      await resolveImages(bodyNodes); if (!alive()) return;
      // the sections the journal sets in a panel (the profile's and the style's `panels`: ['Research in context']): the heading and what belongs to it in one box; a figure or table inside it keeps its own page
      // (a style's `panelLabel`: a section headed "Panel: …" or "Panel 2: …" is a panel too, where the manuscript has it)
      if (names.panels.length || sty.panelLabel) {
        const items = bodyNodes.map(n => /^H[1-6]$/.test(n.tagName) ? { level: Number(n.tagName[1]), text: n.textContent } : { level: n.matches('figure, .msd-table, .msd-cap, .msd-note, .msd-refs') ? -1 : 0 });
        for (const { start, end, labelled } of panelSpans(items, names.panels, { label: sty.panelLabel || '' }).reverse()) {
          const box = document.createElement('div'); box.className = 'nj-panel'; box.dataset.sourceBlock = bodyNodes[start].dataset.sourceBlock || ''; if (labelled) box.dataset.labelled = 'true';
          box.append(...bodyNodes.slice(start, end)); bodyNodes.splice(start, end - start, box);
        }
      }
      // a figure and its legend on a page: no larger than the journal prints a figure (its preset's figure page box, or the box its style gives a figure) nor than the page
      const setFigure = (display, node) => {
        let p = makePage('display'); const box = document.createElement('div'); box.className = 'nj-display-content'; p.content.append(box); box.append(...display);
        // a style that places its figures gives a figure its own box (the width in its stylesheet) and has the legend's label apart from its title
        if (sty.floats) { box.classList.add('nj-figure-box'); display.filter(n => n.matches('.msd-cap')).forEach(cap => labelTitle(cap, FIGURE_LABEL, 'nj-figure-label')); }
        const wide = sty.floats ? box.clientWidth : Math.min(figureBox.width, box.clientWidth);
        const img = box.querySelector('img'), chart = box.querySelector('.nj-chart');
        if (chart) {
          // sized to the page box: the figure's width at most, and the height the page leaves under the legend (the chart drawn again for that box)
          const live = charts.get(node), svg = chart.firstElementChild, drawnH = svg?.getBoundingClientRect().height || 0, extra = box.scrollHeight - drawnH;
          // a style that gives a figure its box has the chart drawn as wide as the box's frame leaves it, so its type is the size it is drawn in
          const inside = sty.floats ? Math.min(wide, chart.clientWidth || wide) : wide;
          const fit = { width: inside, height: Math.max(120, Math.min(figureBox.height, p.content.clientHeight - extra - 12)) };
          // what a page leaves a part of the chart that stands without the legend: the page less the box's own frame
          const others = display.filter(n => n !== node); others.forEach(n => { n.style.display = 'none'; });
          const frame = box.scrollHeight - drawnH; others.forEach(n => { n.style.display = ''; });
          const again = live && chartForBox(live, fit, journalLook, { whole: Math.max(120, Math.min(figureBox.height, p.content.clientHeight - frame - 12)), place: node?.dataset.place || '' });
          if (again) chart.innerHTML = marked(again.svg);
          box.style.setProperty('--nj-figure-w', `${wide}px`);
          chart.style.setProperty('--nj-figure-h', `${fit.height}px`);
          // a chart its journal carries over pages in place of setting it smaller (the look's parts): each part before the last in the figure's box on a
          // page of its own, and the last with the legend on the page after them
          if (again?.parts?.length > 1 && node) {
            for (const part of again.parts.slice(0, -1)) {
              const b = box.cloneNode(false), f = node.cloneNode(false), c = chart.cloneNode(false);
              c.innerHTML = marked(part); c.style.removeProperty('--nj-figure-h'); f.append(c); b.append(f); b.classList.add('nj-figure-part'); p.content.append(b);
              p = makePage('display');
            }
            p.content.append(box);
          }
        }
        if (img) {
          img.removeAttribute('width'); img.removeAttribute('height');
          const extra = box.scrollHeight - img.getBoundingClientRect().height;
          // no larger than the journal prints a figure (its preset's figure page box), nor than the page's text block
          img.style.maxHeight = `${Math.max(120, Math.min(figureBox.height, p.content.clientHeight - extra - 12))}px`;
          box.style.setProperty('--nj-figure-w', `${wide}px`);
        }
        if (box.scrollHeight > p.content.clientHeight + 1) throw new Error('A figure and its caption need more space than a journal page.');
        return p;
      };
      // the end matter a journal sets small (the style's `backFrom`: the headings it begins at): marked for the stylesheet from the first of them on
      if (sty.backFrom?.length) {
        const keys = new Set(sty.backFrom.map(headingKey)), from = bodyNodes.findIndex(n => /^H[1-6]$/.test(n.tagName) && keys.has(headingKey(n.textContent)));
        if (from >= 0) for (const n of bodyNodes.slice(from)) if (n.matches('h1, h2, h3, h4, h5, h6, p:not(.msd-cap, .msd-note)')) n.classList.add('nj-back');
      }
      if (sty.panelAt === 'page-top') {
        // (the panels the style and its profile name; one found by the style's label stands by its citation, below)
        for (let k = bodyNodes.length - 1; k >= 0; k--) if (bodyNodes[k].matches('.nj-panel:not([data-labelled])')) tops.unshift(...bodyNodes.splice(k, 1));
        // the body opened a page before the panels were known (an abstract that fills the first page): the panel heads that page
        if (tops.length && bodyPage && bodyPage !== first && bodyPage.cols && !bodyPage.cols.some(c => c.children.length)) {
          setTop(tops.shift(), bodyPage, bodyPage.cols[0].parentElement);
          if (bodyPage.full) { bodyPage.cols[0].parentElement.remove(); bodyPage.cols = null; column = nextColumn(); }
        }
      }
      // a panel found by the style's label goes after the block that first cites it ("(panel)", "panel 2": lib/journal-text.mjs panelMention), as the journal
      // sets a panel by its citation and a manuscript keeps it at its end; one the text never cites stays where the manuscript has it
      if (sty.panelLabel) for (const box of bodyNodes.filter(n => n.matches('.nj-panel[data-labelled]'))) {
        const cites = panelMention(box.firstElementChild?.textContent || '', sty.panelLabel), from = bodyNodes.indexOf(box);
        const at = cites ? bodyNodes.findIndex(n => !/^H[1-6]$/.test(n.tagName) && !n.matches('.nj-panel, figure, .msd-table, .msd-refs, .msd-ref, .msd-cap, .msd-note') && cites.test(n.textContent)) : -1;
        if (at >= 0 && at !== from - 1) { bodyNodes.splice(from, 1); bodyNodes.splice(at < from ? at + 1 : at, 0, box); }
      }
      if (sty.floats === 'page-top') {
        // each figure or table with its title and legend leaves the text; a heading that only lists them ("Figure legends") goes with them
        const LISTS = /^(figure legends?|figures?|tables?|tables and figures|figures and tables)$/i;
        for (let k = 0; k < bodyNodes.length; k++) {
          const node = bodyNodes[k];
          if (!(node.matches('figure, .msd-table') || (node.matches('.msd-cap') && bodyNodes[k + 1]?.matches('.msd-table')))) continue;
          let a = k, b = k;
          if (node.matches('.msd-cap') && bodyNodes[b + 1]?.matches('.msd-table')) b++;
          if (node.matches('figure') && bodyNodes[b + 1]?.matches('.msd-cap')) b++;
          while (bodyNodes[b + 1]?.matches('.msd-note')) b++;
          while (a > 0 && /^H[1-6]$/.test(bodyNodes[a - 1].tagName) && LISTS.test(bodyNodes[a - 1].textContent.trim())) a--;
          const display = bodyNodes.slice(k, b + 1);
          floats.push({ display, place: display.find(n => n.dataset.place)?.dataset.place || '', order: floats.length });
          bodyNodes.splice(a, b - a + 1); k = a - 1;
        }
        // where each is first mentioned in the text ("figure 2", "tables 1 and 2"; not "appendix table 2"): it is due once that block is set
        for (const f of floats) {
          const m = /^(Figure|Table)\s+(\S+)$/i.exec(f.place), re = m && new RegExp(`(appendix\\s+|supplementary\\s+|supplement\\s+)?\\b${m[1]}s?\\s+${m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          const at = re ? bodyNodes.findIndex(n => !/^H[1-6]$/.test(n.tagName) && !n.matches('.msd-refs, .msd-ref, .msd-cap') && [...n.textContent.matchAll(re)].some(x => !x[1])) : -1;
          f.anchor = at < 0 ? Infinity : at;
        }
        floats.sort((x, y) => x.anchor - y.anchor || x.order - y.order);
        setFloat = ({ display }) => {
          const before = pages.length, rules = display.some(n => n.matches('.msd-table')) ? tableRules(sty) : null;
          if (display.some(n => n.matches('.msd-table'))) { if (!rules || !setStyledTable(display, makePage, alive, rules, dropPage)) { late.push(display); return null; } }
          else setFigure(display, display.find(n => n.matches('figure')));
          // one upright page with room under it for the text to go on: that page is the body's next
          const p = pages.at(-1), box = p.content.querySelector('.nj-display-content');
          // (a figure carried over pages: the pages before its last hold a part each, and the last may have the text under it)
          const parted = pages.length > before + 1 && pages.slice(before, -1).every(q => q.content.querySelector('.nj-figure-part'));
          if ((pages.length !== before + 1 && !parted) || !box || p.sheet.classList.contains('nj-landscape')) return null;
          if (p.content.clientHeight - box.offsetHeight - (parseFloat(getComputedStyle(box).marginBottom) || 0) < 150) return null;
          p.sheet.classList.add('nj-hosts'); box.classList.add('nj-float');
          return p;
        };
      }
      for (let i = 0; i < bodyNodes.length; i++) {
        if (!alive()) return;
        if (requeue.length) bodyNodes.splice(i, 0, ...requeue.splice(0));
        const node = bodyNodes[i];
        if (node.matches('.msd-refs')) { const rows = [...node.children]; styleReferences(rows, sty, kit, r.model, papers); if (sty.referenceMarks) rows.forEach(row => markReference(row, sty.referenceMarks)); bodyNodes.splice(i, 1, ...rows); i--; continue; }
        if (node.matches('figure, .msd-table') || (node.matches('.msd-cap') && bodyNodes[i + 1]?.matches('.msd-table'))) {
          const display = [node];
          // A source heading for the display belongs with it, not at the bottom of the preceding column.
          const headings = [];
          while (column?.lastElementChild?.matches('h2,h3,h4')) { const h = column.lastElementChild; h.remove(); headings.unshift(h); }
          display.unshift(...headings);
          if (node.matches('.msd-cap') && bodyNodes[i + 1]?.matches('.msd-table')) display.push(bodyNodes[++i]);
          if (node.matches('figure') && bodyNodes[i + 1]?.matches('.msd-cap')) display.push(bodyNodes[++i]);
          while (bodyNodes[i + 1]?.matches('.msd-note')) display.push(bodyNodes[++i]);
          if (display.some(n => n.matches('.msd-table'))) await tablePages(display, makePage, alive, tableRules(sty), dropPage);
          else setFigure(display, node);
          bodyPage = null; column = null;
          continue;
        }
        if (!column) column = nextColumn();
        // a panel its style never cuts while it fits: at the head of this column when nothing stands in it yet, else of the next (settle), the text going on here
        if (sty.panelWhole && node.matches('.nj-panel') && !node.dataset.cut) {
          if (held.length || column.children.length || !holds(column, node)) held.push(node);
          while (floats.length && floats[0].anchor <= i) due.push(floats.shift());
          continue;
        }
        // Do not strand a heading at the foot of a column.
        if (/^H[1-6]$/.test(node.tagName) && column.clientHeight - (column.lastElementChild?.getBoundingClientRect().bottom - column.getBoundingClientRect().top || 0) < 85 && column.children.length) { const lead = trailingHeads(column); column = nextColumn(); column.append(...lead); }
        await flow(node, () => column, () => (column = nextColumn()), alive);
        while (floats.length && floats[0].anchor <= i) due.push(floats.shift());
        if (i % 12 === 0) await frame();
      }
      // a panel still held, or one no page opened for under a style that keeps it whole: at the head of the columns and pages that follow
      if (sty.panelWhole) for (let k = 0; (held.length || tops.length) && k < 3 * columns + 3; k++) column = nextColumn();
      // what no page opened for: a panel goes on in the columns (one longer than a page, cut); the figures and tables not yet set, or never mentioned, on pages of their own in their order
      for (const box of [...requeue.splice(0), ...held.splice(0), ...tops.splice(0)]) { if (!column) column = nextColumn(); await flow(box, () => column, () => (column = nextColumn()), alive); }
      const rest = [...due.splice(0), ...floats.splice(0)];
      if (rest.length) { for (const f of rest) setFloat(f); bodyPage = null; column = null; }
      for (const display of late.splice(0)) { await tablePages(display, makePage, alive, null, null); bodyPage = null; column = null; }
      if (!alive()) return;
      if (atEnd) {   // the list follows the last text, headed like a section, in the flow of the columns
        const h = document.createElement('h2'); h.textContent = 'Affiliations';
        for (const node of [h, ...parts.affiliations.flatMap(u => nodesOf(u))]) { if (!column) column = nextColumn(); await flow(node, () => column, () => (column = nextColumn()), alive); }
      }
      // a journal that sets the columns of an article's last page to one length (the style's `balanceLast`): the page the text ends on, when it is the last
      if (sty.balanceLast && bodyPage?.cols && bodyPage !== first && bodyPage === pages.at(-1)) await balanceColumns(bodyPage.cols, alive);
      if (!alive()) return;
      controls(r.stale?.flags?.record); resize = watchWidth(viewport, fit, { rows: true }); fit(); host.dataset.ready = 'true';
      // a trackpad pinch (or Control and the wheel) zooms as the zoom buttons do, the page under the fingers kept under them (owner, 6 Nov 2026)
      unpinch = pinchZoom(viewport, { live: true, units: '.nj-page-wrap', min: zoomSteps[0], max: zoomSteps.at(-1), get: () => scaleShown, set: next => { zoom = String(next); fit(); } });
    } catch (error) { if (alive()) stack.replaceChildren(para('nj-error', `Preview unavailable: ${error.message}`)); }
  })();
  return { ready, release() { disposed = true; resize?.(); unpinch?.(); cancelAnimationFrame(scrollFrame); urls.forEach(u => URL.revokeObjectURL(u)); urls = []; } };
}

// The blocks a box (a panel) holds, and the block a cut runs through at the end of a part of it (`last`) or at the start: the part itself
// when it is a paragraph, else the innermost of its last (first) blocks.
const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, section';
const edgeBlock = (part, last) => { let b = part; for (let c; (c = last ? b.lastElementChild : b.firstElementChild) && c.matches(BLOCKS);) b = c; return b; };
/** A heading, or a short paragraph set wholly in bold (a run-in head, as the heads of The Lancet's panel are): never cut in two, and in a box never left at a column's foot. */
const isHead = el => /^H[1-6]$/.test(el.tagName) || (el.children.length === 1 && /^(STRONG|B)$/.test(el.firstElementChild.tagName) && el.firstElementChild.textContent.trim() === el.textContent.trim() && el.textContent.trim().length <= 120);
/**
 * A node cut in two at a column's foot, `lead` already in its column and `rest` going to the next. The cut runs through one block: the
 * paragraph itself, or in a box the last of its blocks. That block's last line here is a line of running text and is set as its other lines
 * are: flush to both edges when the paragraph is justified (nj-split-end), never when it is a heading or ragged (a reference), and never the
 * blocks of the box that end before the cut, whose last lines are their own. What continues it begins without a first-line indent
 * (nj-split-start). A cut that falls between two blocks cuts nothing: the empty remainder of the block before it is dropped.
 */
function markCut(lead, rest) {
  const end = edgeBlock(lead, true), start = edgeBlock(rest, false);
  if (!start.textContent.trim()) { for (let n = start; n !== rest && !n.textContent.trim();) { const up = n.parentElement; n.remove(); n = up; } return; }
  if (!isHead(end) && getComputedStyle(end).textAlign === 'justify') end.classList.add('nj-split-end');
  start.classList.add('nj-split-start');
}

/** The headings a column ends with, taken out of it to go on with the block that follows them (a heading never ends a column); none when the column holds nothing else. */
function trailingHeads(column) {
  const kids = [...column.children]; let k = kids.length;
  while (k > 0 && /^H[1-6]$/.test(kids[k - 1].tagName)) k--;
  if (k === 0 || k === kids.length) return [];
  const lead = kids.slice(k); lead.forEach(h => h.remove()); return lead;
}

/** Fill a column, splitting only text paragraphs (and the paragraphs of a box) at word boundaries, a box between its blocks too, and retaining every inline run. */
async function flow(node, getColumn, advance, alive) {
  let column = getColumn();
  column.append(node);
  if (column.scrollHeight <= column.clientHeight + 1) return;
  node.remove();
  // a block that goes to the next column whole takes with it the headings it would leave at this column's foot
  const heads = () => trailingHeads(column);
  if (/^H[1-6]$/.test(node.tagName)) { const lead = heads(); advance().append(...lead, node); return; }
  const text = node.textContent || '', ends = [...text.matchAll(/\s+/g)].map(m => m.index + m[0].length);
  if (!ends.length || !node.matches('p, div')) { const lead = heads(); advance().append(...lead, node); return; }
  // where a block of a box begins: its text runs on from the block before without a space, so a cut between the two is a place of its own
  // (without it a block's last word went to the next column with the block after it, and a one-line head was cut before its last word)
  const starts = new Set();
  { const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let n, at = 0, block = null;
    while ((n = walker.nextNode())) { const b = n.parentElement.closest(BLOCKS); if (at && b !== block) starts.add(at); block = b; at += n.length; } }
  const words = [...new Set([...ends, ...starts])].sort((a, b) => a - b);
  // Range fragments retain superscripts, italics, hyperlinks and non-ASCII text.
  const fragment = (start, end) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), texts = []; let n, at = 0;
    while ((n = walker.nextNode())) { texts.push({ n, start: at, end: at + n.length }); at += n.length; }
    const a = texts.find(t => start <= t.end), b = texts.find(t => end <= t.end) || texts.at(-1);
    const clone = node.cloneNode(false); if (!a || !b) return clone;
    const range = document.createRange(); range.setStart(a.n, start - a.start); range.setEnd(b.n, end - b.start);
    // a range that lies inside one element of the node (the last paragraph of a box, an italic run) is cloned without it: it is put back around it
    let inner = range.cloneContents();
    for (let up = range.commonAncestorContainer; up && up !== node; up = up.parentNode) if (up.nodeType === 1) { const shell = up.cloneNode(false); shell.append(inner); inner = shell; }
    clone.append(inner); return clone;
  };
  let lo = 0, hi = words.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, candidate = fragment(0, words[mid]); column.append(candidate); const fits = column.scrollHeight <= column.clientHeight + 1; candidate.remove(); if (fits) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  // the lines of a part set in this column, or of one block of it
  const lineCount = (part, block = part) => {
    column.append(part);
    const range = document.createRange(); range.selectNodeContents(block);
    const tops = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.top / 3));
    const count = new Set(tops).size; part.remove(); return count;
  };
  // Keep at least two lines of a split paragraph on either side of the break: of the paragraph the cut runs through, which in a box is one
  // of its blocks. A head is not cut, and a cut between two blocks does not leave one at the column's foot.
  const holds = at => {
    const lead = fragment(0, words[at]), rest = fragment(words[at], text.length), end = edgeBlock(lead, true);
    if (isHead(end) || lineCount(lead) < 2) return false;
    return starts.has(words[at]) || (lineCount(lead, end) >= 2 && lineCount(rest, edgeBlock(rest, false)) >= 2);
  };
  while (best >= 0 && !holds(best)) best--;
  if (best < 0) {
    if (!column.children.length) { column.append(node); throw new Error('A source block is too large for a journal column.'); }
    const lead = heads(); advance().append(...lead); return flow(node, getColumn, advance, alive);
  }
  const lead = fragment(0, words[best]), rest = fragment(words[best], text.length); column.append(lead); markCut(lead, rest);
  if (!rest.textContent) return;
  advance(); await frame(); if (alive()) await flow(rest, getColumn, advance, alive);
}

/**
 * The columns of a page set to one length, as a journal sets those of the page an article ends on (a style's `balanceLast`): what the columns
 * hold is flowed again into columns of the least height that holds it all, by the same rules (flow: a paragraph cut at a word with two lines on
 * either side, a heading never at a column's foot). A paragraph cut between two of the columns is made whole first, so its cut falls where the
 * new columns end. Columns that hold anything other than paragraphs and headings (a panel) are left as they are, and so are columns the
 * search cannot fill again: what was there is put back.
 */
async function balanceColumns(cols, alive) {
  const box = cols[0].parentElement, was = cols.map(c => [...c.children]), nodes = [];
  if (cols.length < 2 || was.flat().some(n => !n.matches('p, h1, h2, h3, h4, h5, h6'))) return;
  was.forEach((list, k) => list.forEach((n, i) => {
    const copy = n.cloneNode(true), lead = nodes.at(-1);
    if (k && !i && lead && n.matches('p.nj-split-start') && lead.matches('p')) { lead.classList.remove('nj-split-end'); lead.append(...copy.childNodes); } else nodes.push(copy);
  }));
  const full = cols[0].clientHeight, depth = c => (c.lastElementChild ? c.lastElementChild.offsetTop + c.lastElementChild.offsetHeight - c.offsetTop : 0);
  const total = cols.reduce((sum, c) => sum + depth(c), 0);
  if (!nodes.length || !(total > 0) || !(full > 0)) return;
  const spill = document.createElement('div');
  const set = async height => {
    box.classList.add('nj-columns-set'); box.style.setProperty('--nj-columns-height', `${height}px`); cols.forEach(c => c.replaceChildren());
    let k = 0, over = false;
    try { for (const n of nodes) { if (over || !alive()) break; await flow(n.cloneNode(true), () => (over ? spill : cols[k]), () => (k + 1 < cols.length ? cols[++k] : (over = true, spill)), alive); } }
    catch { over = true; }
    return !over;
  };
  let lo = Math.ceil(total / cols.length), hi = full, best = 0;
  while (alive() && hi - lo > 2) { const mid = Math.round((lo + hi) / 2); if (await set(mid)) { best = mid; hi = mid; } else lo = mid; }
  const done = alive() && best > 0 && await set(best);
  box.classList.remove('nj-columns-set'); box.style.removeProperty('--nj-columns-height');
  if (!done) cols.forEach((c, k) => c.replaceChildren(...was[k]));
}

/** Keep every source cell at a readable size; repeat the header when rows continue on another page. */
async function tablePages(nodes, makePage, alive, rules = null, dropPage = null) {
  // a journal style that declares how it sets tables (the style's `table`) has them set so; one that declares none, as below
  if (rules && dropPage && await styledTablePages(nodes, makePage, alive, rules, dropPage)) return;
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

const cellText = c => c.textContent.replace(/\s+/g, ' ').trim();
/** Each short bracket of an element's text in a span that is not broken (span.nj-val), across the marks the text may carry (a number's own span). */
function keepBrackets(el) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
  const at = (pos, end) => { let i = 0; for (const n of nodes) { if (end ? pos <= i + n.data.length : pos < i + n.data.length) return [n, pos - i]; i += n.data.length; } return null; };
  // from the last to the first, so the places before a bracket already wrapped still hold
  for (const m of [...nodes.map(n => n.data).join('').matchAll(/\([^()]{1,12}\)/g)].reverse()) {
    const from = at(m.index, false), to = at(m.index + m[0].length, true);
    if (!from || !to) continue;
    const range = document.createRange(), keep = document.createElement('span');
    range.setStart(from[0], from[1]); range.setEnd(to[0], to[1]); keep.className = 'nj-val';
    try { range.surroundContents(keep); } catch { /* a bracket that runs through the end of a mark is left as it is */ }
  }
}
const firstText = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n = w.nextNode(); while (n && !n.data.trim()) n = w.nextNode(); return n; };
/** The marks a journal's stylesheet draws a table from (lib/journal-table.mjs), set on the manuscript's own cells: a body row's level, band and
 *  section, a spanning head and the heads under it, a value that is not broken. When the style declares them, a head with nothing over it is
 *  raised to the top row and the lead of a number is wrapped (span.nj-int) for alignNumbers. No cell's text changes. */
function markTable(table, rules) {
  const headRows = table.tHead ? [...table.tHead.rows] : [];
  const read = () => headMarks(headRows.map(r => [...r.cells].map(c => ({ span: c.colSpan, down: c.rowSpan, text: cellText(c) }))));
  let marks = read();
  if (rules.raiseHeads && headRows.length === 2) {
    const tops = [...headRows[0].cells], low = [...headRows[1].cells];
    let moved = false;
    marks[1].forEach((m, i) => {
      const up = m.raise ? tops[marks[0].findIndex(t => t.col === m.col)] : null;
      if (!up) return;
      up.replaceChildren(...low[i].childNodes); up.rowSpan = 2; low[i].remove(); moved = true;
    });
    if (moved) marks = read();
  }
  headRows.forEach((r, y) => [...r.cells].forEach((c, i) => { if (marks[y][i].spanner) c.dataset.spanner = ''; if (marks[y][i].sub) c.dataset.sub = ''; }));
  // a short bracket in a head is not broken ("(95% CI)", "(n=15)"): the head turns before it
  if (rules.widths === 'content') headRows.flatMap(r => [...r.cells]).forEach(keepBrackets);
  const rows = [...table.tBodies].flatMap(b => [...b.rows]);
  const info = rows.map(r => {
    const c = r.cells[0], t = c ? cellText(c) : '', strong = c ? [...c.querySelectorAll('strong, b')].map(cellText).join(' ') : '';
    return { indent: Number(c?.dataset.indent) || 0, bold: !!t && strong === t, alone: !!t && [...r.cells].slice(1).every(x => !cellText(x)) };
  });
  bodyMarks(info).forEach((m, i) => { rows[i].dataset.level = String(m.level); rows[i].dataset.band = String(m.band); if (m.section) rows[i].dataset.section = ''; });
  const columns = new Map();   // a column's own cells (a cell over several columns is no column's)
  for (const r of rows) { let col = 0; for (const c of r.cells) { if (col > 0 && c.colSpan === 1) (columns.get(col) || columns.set(col, []).get(col)).push(c); col += c.colSpan; } }
  if (rules.widths === 'content') for (const cells of columns.values()) for (const c of cells) if (!c.querySelector('br') && valueLike(c.textContent)) c.classList.add('nj-val');
  if (rules.numbers !== 'decimal') return;
  for (const cells of columns.values()) {
    if (!numberColumn(cells.map(c => c.textContent))) continue;
    for (const c of cells) {
      const node = firstText(c), n = node ? leadLength(cellText(c) === '..' ? '..' : node.data) : -1;
      if (n < 0) continue;
      const lead = document.createElement('span'); lead.className = 'nj-int'; lead.textContent = node.data.slice(0, n); node.data = node.data.slice(n); node.before(lead);
    }
  }
}
/** The leads of a column's numbers made as wide as the column's widest, so its decimal points stand under one another (the table is in the page). */
function alignNumbers(table) {
  const k = table.offsetWidth ? table.getBoundingClientRect().width / table.offsetWidth : 1, columns = new Map();
  for (const r of table.querySelectorAll('tbody tr')) { let col = 0; for (const c of r.cells) { const lead = c.querySelector('.nj-int'); if (lead) (columns.get(col) || columns.set(col, []).get(col)).push(lead); col += c.colSpan; } }
  for (const leads of columns.values()) {
    const w = Math.max(...leads.map(l => l.getBoundingClientRect().width / (k || 1)));
    leads.forEach(l => l.style.setProperty('--nj-lead', `${Math.ceil(w * 100) / 100}px`));
  }
}
/** The label of a table's title ("Table 1:"), or of a figure's legend with `label` and `cls` ("Figure 1:"), in a span of its own, for a style that sets it apart from the title. */
const FIGURE_LABEL = /^\s*(?:Supplementary\s+)?Figure\s+[A-Za-z]?\d+[A-Za-z]?\s*[:.]?/i;
function labelTitle(cap, label = null, cls = 'nj-table-label') {
  const node = firstText(cap), found = !node ? '' : label ? (label.exec(node.data) || [''])[0] : titleLabel(node.data);
  if (!found || cap.querySelector(`.${cls}`)) return;
  const span = document.createElement('span'); span.className = cls; span.textContent = found; node.data = node.data.slice(found.length); node.before(span);
}

/** A table as the journal style's `table` declares it (lib/journal-table.mjs): its title over it or under its legend, in the narrowest of the style's
 *  measures it sets well in or on a turned page when it is too wide for the widest, the column widths following the content, the head repeated and
 *  the style's own words where it runs over a page. Answers false, with nothing left on the pages, when the legend and the title cannot stand on a
 *  page with the head: the table is then set as every table was before. */
async function styledTablePages(nodes, makePage, alive, rules, dropPage) { return setStyledTable(nodes, makePage, alive, rules, dropPage); }
/** The same, at once (nothing in it waits): a page that opens on a table is laid out as it opens. */
function setStyledTable(nodes, makePage, alive, rules, dropPage) {
  const source = nodes.find(n => n.matches('.msd-table')), table = source.querySelector('table');
  if (!table) return true;
  const heads = nodes.filter(n => /^H[1-6]$/.test(n.tagName)), titles = nodes.filter(n => n.matches('.msd-cap')), notes = nodes.filter(n => n !== source && !heads.includes(n) && !titles.includes(n));
  const name = titles[0]?.dataset.place || 'Table', home = table.tBodies[0];
  markTable(table, rules); titles.forEach(cap => labelTitle(cap));
  const count = Math.max(...[...table.rows].map(r => [...r.cells].reduce((n, c) => n + c.colSpan, 0)));
  const made = [];
  const open = turned => {
    const page = makePage('display', turned), box = document.createElement('div');
    box.className = 'nj-display-content nj-table-box'; box.dataset.title = rules.title; page.content.append(box); made.push(page);
    return { page, box };
  };
  const over = () => at.box.getBoundingClientRect().bottom > at.page.content.getBoundingClientRect().bottom + 0.5;
  // the whole table in the box: the measure it takes, and the widths its columns take there
  let turned = false, loose = false, at = open(false);
  table.removeAttribute('width'); if (rules.widths === 'content') table.classList.add('nj-table-auto');
  at.box.append(table);
  if (rules.numbers === 'decimal') alignNumbers(table);
  // content that cannot be set as narrow as the box runs past the box's own edge (the edges are compared as they are drawn, at the page's zoom)
  const wide = () => {
    const cs = getComputedStyle(at.box), k = at.page.sheet.offsetHeight ? at.page.sheet.getBoundingClientRect().height / at.page.sheet.offsetHeight : 1;
    return table.getBoundingClientRect().right - at.box.getBoundingClientRect().right + k * (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) > k;
  };
  const linesOf = c => { const cs = getComputedStyle(c); return Math.round((c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / (parseFloat(cs.lineHeight) || 12)); };
  const most = (sel, per = () => 1) => Math.max(1, ...[...table.querySelectorAll(sel)].filter(cellText).map(c => linesOf(c) / per(c)));
  const headLines = () => most('thead th', c => c.rowSpan), labelLines = () => most('tbody td:first-child');
  const sets = m => {
    at.box.dataset.measure = m.id;
    if (rules.widths !== 'content') return !m.lines || (headLines() <= m.lines && labelLines() <= m.lines);
    // the row labels whole when the heads then set in two lines at most; otherwise the labels give way with the heads
    table.classList.add('nj-stub-whole');
    if (!wide() && headLines() <= 2) return true;
    table.classList.remove('nj-stub-whole');
    return !wide() && (!m.lines || (headLines() <= m.lines && labelLines() <= m.lines));
  };
  let measure = rules.measures.find(sets);
  if (!measure) {
    measure = rules.measures[rules.measures.length - 1];
    if (rules.turn) { table.remove(); dropPage(made.pop()); turned = true; at = open(true); at.box.append(table); }
    // too wide even so: the values may break; then the columns share the width evenly, as in a table without the style's rules
    if (!sets(measure) && wide()) { loose = true; at.box.classList.add('nj-table-loose'); if (wide()) table.classList.remove('nj-table-auto'); }
  }
  const ruler = document.createElement('tr'); ruler.className = 'nj-measure'; ruler.innerHTML = '<td></td>'.repeat(count); (home || table).append(ruler);
  const widths = [...ruler.cells].map(c => c.getBoundingClientRect().width), total = widths.reduce((a, b) => a + b, 0) || 1;   // unrounded: a column a fraction too narrow breaks its longest word
  ruler.remove(); table.remove(); table.classList.remove('nj-table-auto');
  const header = table.tHead?.cloneNode(true), rows = [...table.tBodies].flatMap(b => [...b.rows]);
  let body, more;
  const start = continued => {
    if (continued) at = open(turned);
    at.box.dataset.measure = measure.id; at.box.classList.toggle('nj-table-loose', loose);
    if (!continued) heads.forEach(n => at.box.before(n));   // a heading of the manuscript that leads to the table stands over its box
    if (rules.title === 'above') titles.forEach(n => at.box.append(n.cloneNode(true)));
    const t = table.cloneNode(false), cols = document.createElement('colgroup');
    widths.forEach(w => { const c = document.createElement('col'); c.style.setProperty('--nj-column-width', `${100 * w / total}%`); cols.append(c); });
    t.append(cols); if (header) t.append(header.cloneNode(true));
    body = document.createElement('tbody'); t.append(body);
    if (continued && rules.continues.previous) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      tr.className = 'nj-table-continued'; td.colSpan = count; td.textContent = rules.continues.previous; tr.append(td); body.append(tr);
    }
    more = para('nj-table-continuation', rules.continues.next.replace('{table}', name));
    at.box.append(t, more);
  };
  const own = b => [...b.rows].filter(r => !r.matches('.nj-table-continued'));
  start(false);
  for (const row of rows) {
    if (!alive()) return true;
    body.append(row);
    if (over()) {
      row.remove();
      if (!own(body).length) throw new Error('A table row is taller than a journal page.');
      start(true); body.append(row);
      if (over()) throw new Error('A table row is taller than a journal page.');
    }
  }
  // the legend and, when the style sets it there, the title under the last rows; with the last rows on a page of their own when they do not fit
  const legend = document.createElement('div'); legend.className = 'nj-table-note'; notes.forEach(n => legend.append(n));
  const foot = [...(notes.length ? [legend] : []), ...(rules.title === 'below' ? titles : [])];
  more.remove(); at.box.append(...foot);
  if (over() && foot.length) {
    foot.forEach(n => n.remove()); at.box.append(more);
    const before = body;
    start(true); more.remove(); at.box.append(...foot);
    if (over()) {
      // not on a page with the head either: back to the manuscript's table, set as before
      rows.forEach(r => (home || table).append(r)); source.append(table); while (made.length) dropPage(made.pop());
      return false;
    }
    const lead = body.querySelector('.nj-table-continued');
    for (let moved = 0; moved < 2 && own(before).length > 1; moved++) {
      const row = own(before).pop();
      if (lead) lead.after(row); else body.prepend(row);
      if (over()) { before.append(row); break; }
    }
  }
  return true;
}

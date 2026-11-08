import { mountJournalPreview, journalPreviewAvailable } from './journal-preview.mjs';
// The Manuscript page's reader for a manuscript built outside Lykos and registered (tools/lykos-register.mjs): the Word file itself, drawn
// as text to read (lib/docx-reading.mjs), with its outline and each section's words beside it, a search, and the Supplement that went with
// it. 2 Nov 2026, the owner: "why I cannot read the manuscript — just see the word count etc and open the paper in Word, not in the app?" The
// registration's summary moved to the inspector (views/manuscript-registered.mjs registeredSections).
//
// A number the project's number check matched to a source shows that source on the number (the analysis results' line, the Lykos output,
// the record); a table's or figure's caption opens the Lykos output it was made from in Tables and figures; what changed in the data after
// it was built is marked; a figure made from a Lykos output is drawn live in the app's own style (theme and all), its print picture only when
// the output cannot be drawn here; a citation shows the entries of the reference list it names. A large supplement is put on the page a
// part at a time as it is scrolled to; the file is read again when it changes on disk (lib/folder-poll.mjs). Loaded on first use
// (views/manuscript.mjs). Comments stand beside the text once it is painted (views/manuscript-comments.mjs: the checks' cards, and a
// model's answer on a selected passage), loaded then, not with the reader.
//
// Every entry of the reference list, and every entry of a citation's card, opens in the side panel (views/manuscript-reference.mjs):
// the manuscript's own uses of it first, then what it says, then its abstract (a record's, else looked up on open). 3 Nov 2026, the
// owner: "not all papers have the hover click thing?", "at least when clicked i should see how did we used them".
//
// Two views of each file, the title bar's switch (kept per file): App, the text read in the app's type; Word, the file's own pages in the
// Files view's Word document (views/file-doc.mjs mountDocument: edited and saved paragraph by paragraph, never over a copy changed on
// disk), with the same outline, Find and citations beside and on it. An edit saved there is recorded on the registration as the owner's
// own (edited: { at, sha256, size }, its words counted again), so the file reads as edited in Lykos, not as changed since it was registered.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { findBarSpec } from '../lib/ui-recipes.mjs';
import { lib_folder_poll$pollFolder as pollFolder } from "../boot.mjs";
import { watchNarrow } from '../lib/narrow.mjs';
import { titleOnly } from '../lib/table-fit.mjs';
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";
import { keptFolder } from '../lib/kept-files.mjs';
import { store$get as get } from "../boot.mjs";
import { targetJournal } from '../lib/journal-context.mjs';
import { parseDocx } from '../lib/docx.mjs';
import { structureCounts } from '../lib/manuscript-structure.mjs';
import { readingModel, staleKind, referencesOf, currentSection, readingLine, referenceRecord, prepareLibrary } from '../lib/docx-reading.mjs';
import { parseNumberCheck, resultsIndex, resultLine, sourceKind, manuscriptOutputs } from '../lib/number-sources.mjs';
import { readNumberCheck, numberCheckEntry, placedRows, changedSince, staleNumbers, placeText } from '../lib/number-check.mjs';
import { lib_fields$fields as fields } from "../boot.mjs";
import { proofChain, CHAIN_MAX } from '../lib/proof-chain.mjs';
import { proofStateReady } from '../lib/proof-state.mjs';
import { externalOutputs, writtenAfter } from '../lib/review-state.mjs';
import { outputById, currentSpec } from '../lib/output-spec.mjs';
import { readerDocs, shownDoc, modeOf } from './manuscript-registered.mjs';
import { mountDocument } from './file-doc.mjs';
import { store$update as update } from "../boot.mjs";
import { chartSvg } from '../lib/output-render.mjs';
import { liveSpecOf, liveModelOf } from '../lib/live-figure.mjs';
import { wireMarkCard, wireMarkPress } from '../lib/chart-card.mjs';
import { figureTokens } from '../lib/figure-style.mjs';
import { lib_html$sanitizeSvg as sanitizeSvg } from "../boot.mjs";
import { uiMeter } from '../lib/ui-meter.mjs';
import { cleanDoi, normTitle } from '../lib/reference-list.mjs';
import { lib_native$openLink as openLink, lib_native$doiUrl as doiUrl } from "../boot.mjs";
import { lib_dialog$confirmAsk as confirmAsk, lib_dialog$choiceAsk as choiceAsk } from "../boot.mjs";
import { pinchZoom } from '../lib/pinch-zoom.mjs';

const FIRST = 120_000, NEXT = 160_000;   // characters of HTML put on the page at first, and with each part after
const NARROW = 820;   // below this width the outline stands above the text (lib/narrow.mjs data-narrow)
const NARROW_WORD = 700;   // the pages fit themselves to the width they have (Fit width), so the outline stays beside them longer
const dec = new TextDecoder();
const base = f => String(f || '').split('/').pop();
const dir = f => String(f || '').split('/').slice(0, -1).join('/');

let cur = null;   // { el, key, doc, model, … } of the reader on the page

// ---- reading the files ------------------------------------------------------------------------------------------------------
const cache = new Map();   // path -> { stamp, value }: a file read once per change on disk
async function readOnce(folder, path, as, statOf = folder.stat(path)) {
  const st = await statOf.catch(() => null);
  if (!st?.exists) return { missing: true };
  const stamp = `${st.mtime}:${st.size}`, hit = cache.get(path);
  if (hit?.stamp === stamp) return { value: hit.value, stamp };
  const bytes = await folder.read(path);
  const value = await as(bytes);
  cache.set(path, { stamp, value });
  return { value, stamp };
}
const text = bytes => dec.decode(bytes);
const json = bytes => { try { return JSON.parse(dec.decode(bytes)); } catch { return null; } };

/** The registration's sources around the file: the number check, the build's map of outputs, the figures folder, the results. `docStat`: the file's own stat, asked once by the caller.
 *  The files are independent, so they are asked at once (each call is a round trip into the folder); a figure's time comes with the listing. */
async function sourcesOf(folder, e, doc, docStat) {
  const nc = e.numberCheck?.file, structured = numberCheckEntry(e)?.structured?.file, out = {};
  // the build's map of Lykos outputs: registered with the manuscript (--outputs), or where the project's build keeps it beside the check
  const mapFile = e.outputsFile || (nc ? `${dir(nc)}/build/lykos-outputs.json` : '');
  const figures = doc.key === 'manuscript' && folder.list ? figuresOf(folder, doc, docStat) : null;
  const [rows, map, sidecar, drawn, figs, check] = await Promise.all([
    nc ? readOnce(folder, nc, b => parseNumberCheck(text(b))) : null,
    mapFile ? readOnce(folder, mapFile, json) : null,
    readOnce(folder, '.lykos/mcp-outputs.json', json),
    readOnce(folder, '.lykos/outputs.json', json),
    figures,
    // the check as data (lib/number-check.mjs): each number's place and source, read instead of matching the rows again
    structured ? readOnce(folder, structured, b => readNumberCheck(json(b))) : null,
  ]);
  if (rows) out.rows = rows.value || null;
  if (check?.value && !check.value.newer) out.check = check.value;
  if (map) out.map = map.value || null;
  // the project's own outputs: read only for a build's map to be read against
  if (out.map) { out.sidecar = sidecar.value || null; out.drawn = drawn.value || null; }
  if (figs) out.figures = figs;
  return out;
}
/** A manuscript's own figures travel as files beside it ("Figures/Figure1_PRISMA_flow.png"): Figure n -> its path. */
async function figuresOf(folder, doc, docStat) {
  const files = await folder.list(`${dir(doc.file)}/Figures`).catch(() => []), figs = new Map();
  const rank = n => (/\.png$/i.test(n) ? 0 : /\.jpe?g$/i.test(n) ? 1 : /\.svg$/i.test(n) ? 2 : 9);
  // a picture belongs to this build only when it was written before the Word file (the build draws the figures first): an older
  // version of the manuscript left beside the newest build's Figures folder took the newer pictures by number (2 Nov 2026)
  const built = (await docStat.catch(() => null))?.mtime || 0, SLACK = 120_000;
  const chosen = [];
  for (const f of files.filter(f => !f.dir && rank(f.name) < 9).sort((a, b) => rank(a.name) - rank(b.name))) {
    const m = /^Figure[\s_-]*0*(\d+)[\s_.-]/i.exec(f.name);
    if (!m || chosen.some(c => c.key === `Figure ${m[1]}`)) continue;
    chosen.push({ key: `Figure ${m[1]}`, rel: f.rel || `${dir(doc.file)}/Figures/${f.name}`, mtime: f.mtime });
  }
  // the listing carries each file's modified time (lib/fsys.mjs); a folder whose listing does not is asked for it, all at once
  const times = await Promise.all(chosen.map(c => (c.mtime ? c.mtime : folder.stat(c.rel).then(st => st?.mtime, () => 0))));
  chosen.forEach((c, i) => { const at = times[i] || 0; if (!(built && at && at > built + SLACK)) figs.set(c.key, c.rel); });
  return figs;
}

/** What changed after the file was built: the analysis run, the record, each output (marks numbers and captions). */
function staleOf(s, e, src) {
  const ext = externalOutputs(s);
  const specs = new Map();
  for (const o of src.sidecar?.outputs || []) specs.set(o.id, o.versions?.at(-1)?.n || 0);
  for (const id of Object.keys(src.map || {})) { const own = outputById(s, id); if (own) specs.set(id, Math.max(specs.get(id) || 0, own.versions?.at(-1)?.n || 0)); }
  const files = new Map(Object.entries(src.drawn || {}).map(([k, v]) => [k, Number(v?.version) || 0]));
  const memo = new Map(), dataAfter = at => { if (!memo.has(at)) memo.set(at, writtenAfter(s, at)); return memo.get(at); };
  const outputs = manuscriptOutputs(src.map, { specs, files, dataAfter });
  // a structured number is stale when a value it rests on (its own, or its run's) was written after the manuscript was built
  const numbers = src.check ? staleNumbers(src.check, changedSince(s.values, e.builtAt || e.at)) : null;
  return { outputs, flags: { results: !!ext.analysis?.stale, record: !!(ext.manuscript || e).stale, outputs: new Set([...outputs.values()].filter(o => o.stale).map(o => o.id)), ...(numbers ? { rows: numbers.rows } : {}) },
    analysis: ext.analysis || null, record: (ext.manuscript || e).after?.text || '', numbers };
}

// User-timing marks of an open (performance.getEntriesByType('mark'), ms:*): the file read, its sources, the stale checks, the model, the page drawn and painted
const mark = name => { try { performance.mark(`ms:${name}`); } catch { /* no timing here */ } };
// the thread given back between the stages of an open, after the frame that shows the stage (a press on the rail is answered in between)
const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
/** The stages of an open as the page shows them (uiMeter): the one being done, of three. */
const STAGES = ['Reading the file', 'Reading its sources and figures', 'Laying out the text'];
async function load(e, doc, stage = () => {}) {
  mark('load');
  // no folder open (a project copied into the app): the Word files kept with the copy (lib/kept-files.mjs)
  const folder = activeFolder()?.read ? activeFolder() : keptFolder(), kept = folder.kind === 'kept';
  // the file's own stat is asked once, and the file and its sources are read together
  const docStat = folder.stat(doc.file);
  docStat.catch(() => {});
  const sources = sourcesOf(folder, e, doc, docStat);
  sources.catch(() => {});
  const read = await readOnce(folder, doc.file, b => parseDocx(b), docStat).catch(err => ({ error: err.message }));
  if (read.missing) return { error: kept ? `${base(doc.file)} was not kept with this copy of the project. Add the project from its folder to read it.` : `${doc.file} is not in the project folder: it was moved or renamed after it was registered. Register the current file again.` };
  if (read.error) return { error: `${base(doc.file)} could not be read (${read.error}). Open it in Word from the title bar.` };
  mark('docx');
  stage(1); await breathe();
  const d = read.value, src = await sources.catch(() => ({}));
  mark('sources');
  stage(2); await breathe();
  const s = get(), stale = staleOf(s, e, src);
  mark('stale');
  await breathe();
  let sectionWords = null;
  const c = doc.key === 'manuscript' ? structureCounts(d.blocks) : null;
  if (c) {
    // the main text's sections as the journal counts them, the same count as the registration's
    sectionWords = new Map();
    if (c.abstract?.index != null) sectionWords.set(c.abstract.index, c.abstract.words);
    for (const x of c.main.sections) { sectionWords.set(x.index, x.words); for (const y of x.subsections || []) sectionWords.set(y.index, y.words); }
  }
  const placed = src.check ? placedRows(src.check, base(doc.file)) : null;
  const model = readingModel(d, { file: base(doc.file), numberRows: src.rows, placed, stale: stale.flags, outputs: stale.outputs, figures: src.figures, sectionWords });
  mark('model');
  return { d, model, src, stale, stamp: read.stamp, counts: c ? { main: c.main.words, abstract: c.abstract?.words ?? null } : null };
}

// ---- the page ---------------------------------------------------------------------------------------------------------------
/** The reader in `el` for the registered manuscript `e`; drawn again only when the file shown changes. `ctx` is the view's context. */
export function mountReader(el, e, ctx) {
  const doc = shownDoc(e);
  if (!doc) return;
  // with no folder the kept copy is read in the app's view: there is no Word file there to edit
  const storedMode = activeFolder()?.read ? modeOf(doc) : 'app', mode = storedMode === 'journal' && !journalPreviewAvailable(e, doc, targetJournal(get())) ? 'app' : storedMode, key = `${doc.file}|${mode}`;
  // a repaint of the page (the shell empties it) takes the reader as it was: its parts on the page, its place, its search
  if (cur && cur.key === key && cur.root) {
    Object.assign(cur, { el, ctx, e });
    if (cur.root.parentElement !== el) { const holder = el.querySelector(':scope > .msd, :scope > .msd-journal'); if (holder) holder.replaceWith(cur.root); else el.append(cur.root); }
    // put back on the page, its width is measured again (the width watch may have measured it off the page)
    requestAnimationFrame(() => { const w = cur?.root?.clientWidth; if (w) cur.root.toggleAttribute('data-narrow', titleOnly(w, cur.mode === 'word' ? NARROW_WORD : NARROW)); });
    const top = cur.keptTop;
    if (top != null) requestAnimationFrame(() => { const sc = scrollerOf(el); if (sc) sc.scrollTop = top; });
    cur.keptTop = null;
    if (cur.model && cur.mode === 'app') { watchScroll(cur); watchMore(cur); }
    return;
  }
  unmountReader();
  if (mode === 'journal') {
    const root = document.createElement('div'); root.className = 'msd-journal';
    const holder = el.querySelector(':scope > .msd, :scope > .msd-journal'); if (holder) holder.replaceWith(root); else el.append(root);
    const state = cur = { el, root, key, doc, e, ctx, mode, urls: [], stops: [] };
    const show = () => { state.inst?.release(); state.inst = mountJournalPreview(root, { load: async () => { const r = await load(state.e, doc); if (cur === state) state.stamp = r.stamp; return r; }, folder: activeFolder(), entry: state.e, doc, paper: get().paper, journal: targetJournal(get()), papers: get().papers }); };
    show();
    state.stops.push(pollFolder(async paths => {
      if (cur !== state || paths && !paths.some(p => p === '*' || p === doc.file || p.endsWith(`/${doc.file}`))) return;
      const st = await activeFolder()?.stat(doc.file).catch(() => null), stamp = st && `${st.mtime}:${st.size}`;
      if (cur !== state) return;
      if (state.stamp && stamp !== state.stamp) show(); state.stamp = stamp;
    }, 4000));
    return;
  }
  const docs = readerDocs(e);
  // the reader's own box only: what else the page holds (a title bar drawn into it) stays
  const box = document.createElement('div');
  const body = mode === 'word' ? '<div class="msd-word" data-word></div>' : '<article class="msd-doc" data-doc-body lang="en"></article>';
  box.innerHTML = `<div class="msd" data-doc="${esc(doc.key)}" data-msd-view="${mode}" data-contents="${outlineOn ? 'on' : 'off'}">
    <nav class="msd-side" aria-label="Outline of the ${esc(doc.label.toLowerCase())}"><div class="msd-counts" data-counts></div><ol class="msd-outline" data-outline></ol></nav>
    <div class="msd-main"><div class="msd-find" data-find hidden></div><div class="msd-loading" data-loading role="status">${uiMeter({ done: 0, total: STAGES.length, label: `Opening ${base(doc.file)}`, now: STAGES[0] })}</div><p class="msd-state" data-state hidden></p>${body}</div></div>`;
  const root = box.firstElementChild, holder = el.querySelector(':scope > .msd, :scope > .msd-journal');
  if (holder) holder.replaceWith(root); else el.append(root);
  watchNarrow(root, mode === 'word' ? NARROW_WORD : NARROW);
  const state = cur = { el, root, key, doc, docs, e, ctx, mode, rendered: 0, urls: [], query: '', hits: [], at: -1, findOpen: false, stops: [] };
  if (mode === 'app') {
    // a trackpad pinch (and Control or Command with the wheel) sets the text larger or smaller, its lines wrapped again to the column;
    // the margin's cards are placed again once the pinch ends
    const article = root.querySelector('[data-doc-body]');
    if (textZoom !== 1) article.style.zoom = String(textZoom);
    state.stops.push(pinchZoom(root.querySelector('.msd-main'), { live: true, units: '.msd-u', min: .75, max: 2, scroller: () => scrollerOf(state.el),
      get: () => textZoom, set: next => { textZoom = next; article.style.zoom = String(next); }, done: () => root.dispatchEvent(new CustomEvent('ui-width')) }));
  }
  if (mode === 'word') mountWord(state);
  load(e, doc, k => stageShown(state, k)).then(r => { if (cur === state) { (mode === 'word' ? drawSide : draw)(state, r); mark('drawn'); requestAnimationFrame(() => requestAnimationFrame(() => mark('paint'))); } }, err => { if (cur === state) fail(state, `${base(doc.file)} could not be read (${err.message}). Open it in Word from the title bar.`); });
  // read again when the file, its number check or the build's map changes on disk
  state.stops.push(pollFolder(async paths => {
    if (cur !== state || !state.stamp) return;
    const watch = [doc.file, e.numberCheck?.file].filter(Boolean);
    if (paths && !paths.some(p => p === '*' || watch.some(w => p === w || p.endsWith(`/${w}`)))) return;
    const st = await activeFolder()?.stat(doc.file).catch(() => null);
    if (!st?.exists || `${st.mtime}:${st.size}` === state.stamp) return;
    if (state.mode === 'word') { if (state.inst?.dirty() || state.saving) return; const r = await load(state.e, doc); if (cur === state && !r.error) { state.stamp = r.stamp; remountWord(state); drawSide(state, r); } return; }
    const r = await load(state.e, doc);
    if (cur === state && !r.error) { const at = topUnit(state); draw(state, r); jump(state, at, { smooth: false }); }
  }, 4000));
}

/** The reader leaves the page. `keep`: the page is only being painted again, so the reader stays as it is for mountReader to take back. */
export function unmountReader({ keep = false } = {}) {
  if (!cur) return;
  closePop();
  if (keep) { cur.keptTop = cur.mode === 'app' ? scrollerOf(cur.el)?.scrollTop ?? null : null; cur.io?.disconnect(); return; }
  for (const stop of cur.stops) { try { stop(); } catch { /* already stopped */ } }
  cur.comments?.stop(); cur.comments = null;
  cur.io?.disconnect(); cur.spy && cur.scroller?.removeEventListener('scroll', cur.spy);
  cur.inst?.release();
  for (const u of cur.urls) URL.revokeObjectURL(u);
  closePop();
  if (globalThis.CSS?.highlights) { CSS.highlights.delete('msd-find'); CSS.highlights.delete('msd-find-now'); }
  cur = null;
}
/** ⌘F and the title bar's Find: the reader's search row, opened and focused. False when no reader is on the page. */
export function openFind() {
  if (!cur?.model && !cur?.layout) return false;
  cur.findOpen = true; drawFind(cur);
  cur.el.querySelector('#msd-find-q')?.focus();
  return true;
}
export const findOpen = () => !!cur?.findOpen;

// The outline (the contents column) is shown or hidden for the window, in either view, and remembered as the inspector's panel is (localStorage).
const OUTLINE_KEY = 'lykos.msOutline';
let outlineOn = true;
let textZoom = 1;   // the App view's text size, set by a pinch; kept while the app is open
try { outlineOn = localStorage.getItem(OUTLINE_KEY) !== 'closed'; } catch { /* shown */ }
export const outlineShown = () => outlineOn;
export function toggleOutline() {
  outlineOn = !outlineOn;
  try { localStorage.setItem(OUTLINE_KEY, outlineOn ? 'open' : 'closed'); } catch { /* kept for this window only */ }
  if (cur) { cur.root.dataset.contents = outlineOn ? 'on' : 'off'; requestAnimationFrame(() => cur?.comments?.refit()); }
}
export function closeSearch() { if (cur) closeFind(cur); }

function fail(state, message) {
  state.el.querySelector('[data-loading]')?.remove();
  const p = state.el.querySelector('[data-state]');
  p.textContent = message; p.hidden = false; p.dataset.tone = 'stopped';
}
// the meter's stage, set in place (the bar's value and its words; nothing else on the page moves)
function stageShown(state, k) {
  const box = state.el.querySelector('[data-loading]');
  if (!box) return;
  const bar = box.querySelector('progress'); if (bar) bar.value = k;
  const now = box.querySelector('.ui-meter-now'); if (now) now.textContent = STAGES[k] || '';
  const count = box.querySelector('.ui-meter-count'); if (count) count.textContent = `${k} of ${STAGES.length}`;
}

// The outline beside the document, the counts over it and the state line: the same in both views.
function drawSide(state, r) {
  if (r.error) { fail(state, r.error); return false; }
  Object.assign(state, { model: r.model, d: r.d, src: r.src, stale: r.stale, stamp: r.stamp, results: null });
  const { el, model, doc } = state;
  el.querySelector('[data-loading]')?.remove();
  const status = el.querySelector('[data-state]');
  const bits = [];
  if (doc.key === 'manuscript' && r.stale.flags.record && r.stale.record) bits.push(`Data changed since it was built: ${r.stale.record}`);
  status.textContent = bits.join(''); status.hidden = !bits.length; status.dataset.tone = bits.length ? 'working' : '';
  // the counts are the file's own, read now (an edit saved in the Word view counts at once), as the registration counts them
  const c = r.counts, counts = doc.key === 'manuscript' && c ? [['Main text', c.main], ['Abstract', c.abstract]].filter(([, v]) => v != null) : [];
  el.querySelector('[data-counts]').innerHTML = counts.length ? `<dl>${counts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${Number(v).toLocaleString('en')} words</dd></div>`).join('')}</dl>` : '';
  // the outline: the document's headings and items, each section's words beside it; a long heading wraps under its own first line
  el.querySelector('[data-outline]').innerHTML = model.outline.length ? model.outline.map((o, k) => `<li><button type="button" class="msd-ol" data-level="${Math.min(o.level, 3)}" data-k="${k}"${o.caption ? ' data-item' : ''}><span class="msd-ol-name">${esc(o.name)}</span><span class="msd-ol-value">${esc(o.value || '')}</span></button></li>`).join('')
    : '<li class="msd-ol-none">This file has no headings</li>';
  el.querySelectorAll('.msd-ol').forEach(b => b.onclick = () => {
    closePop();
    const o = model.outline[+b.dataset.k];
    if (state.mode === 'word') jumpWord(state, o.block ?? 0); else jump(state, o.unit);
    state.pin = +b.dataset.k;
    markOutline(state, state.pin);
  });
  return true;
}
// The entry the outline marks for the scroller's place: a heading at the line counts, the first at the very top, the last at the very
// bottom. An entry just clicked stays marked at the bottom while it is in view, where the scroll could not bring it to the line.
function readingK(state, sc, count, topOf, line, whole) {
  const edge = sc.getBoundingClientRect().top;
  const atTop = sc.scrollTop <= 1, atEnd = whole && sc.scrollTop > 1 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
  let k = currentSection(count, topOf, line, { atTop });
  const pin = state.pin;
  if (pin != null) {
    const t = pin < count ? topOf(pin) : null;
    if (atEnd && t != null && t >= edge && t < edge + sc.clientHeight) return pin;
    if (!atEnd && k >= pin) state.pin = null;
  }
  return atEnd ? currentSection(count, topOf, line, { atEnd }) : k;
}
function markOutline(state, k) {
  state.el.querySelectorAll('.msd-ol[aria-current]').forEach(b => b.removeAttribute('aria-current'));
  const b = state.el.querySelector(`.msd-ol[data-k="${k}"]`);
  if (!b) return;
  b.setAttribute('aria-current', 'location');
  const box = b.closest('.msd-side');
  if (box && box.scrollHeight > box.clientHeight && (b.offsetTop < box.scrollTop || b.offsetTop + b.offsetHeight > box.scrollTop + box.clientHeight - 24)) box.scrollTop = b.offsetTop - box.clientHeight / 3;
}

function draw(state, r) {
  if (!drawSide(state, r)) return;
  state.rendered = 0;
  for (const u of state.urls) URL.revokeObjectURL(u);
  state.urls = []; state.media = new Map((r.d.media || []).map(m => [m.id, m]));
  const body = state.el.querySelector('[data-doc-body]');
  body.innerHTML = state.model.units.length ? '' : '<p class="msd-empty">No text in this file</p>';
  state.comments?.stop(); state.comments = null;
  more(state, FIRST);
  wireDoc(state, body);
  watchScroll(state);
  if (state.query) search(state, state.query);
  commentsLater(state);
}
// The comments (views/manuscript-comments.mjs) are drawn after the text is painted and loaded then, in a task of their own: the open's
// stages and the page's thread are not held by them (app/test/view-open-tasks.browser.test.mjs).
function commentsLater(state) {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(async () => {
    if (cur !== state || !state.model || state.mode !== 'app') return;
    const m = await import('./manuscript-comments.mjs');
    if (cur !== state || state.comments || !state.el.querySelector('[data-doc-body]')) return;
    state.resultsOf = () => resultsOf(state);
    // a number's source and a citation's entries, in the marks' card
    state.markHtml = async n => (n.classList.contains('msd-num') ? (state.model.numbers[+n.dataset.n] ? cardHtml(state, state.model.numbers[+n.dataset.n]) : '') : citeCard(state, n));
    state.markAct = t => markAct(state, t);
    closePop();
    state.comments = m.mountComments(state);
    mark('comments');
  }, 0)));
}

// Units put on the page up to `budget` characters of HTML (or up to unit `upTo`), each part's pictures filled in.
function more(state, budget, upTo = -1) {
  const { model } = state, body = state.el.querySelector('[data-doc-body]');
  if (!body || state.rendered >= model.units.length) return;
  let html = '', k = state.rendered;
  while (k < model.units.length && (html.length < budget || k <= upTo)) { html += `<div class="msd-u" data-u="${k}">${model.units[k].html}</div>`; k++; }
  body.querySelector(':scope > .msd-more')?.remove();
  body.insertAdjacentHTML('beforeend', html + (k < model.units.length ? '<div class="msd-more" aria-hidden="true"></div>' : ''));
  const from = state.rendered;
  state.rendered = k;
  for (const f of body.querySelectorAll(`.msd-u:nth-child(n+${from + 1}) .msd-fig[data-place]`)) liveFigureLater(state, f);
  for (const u of body.querySelectorAll(`.msd-u:nth-child(n+${from + 1}) img[data-media], .msd-u:nth-child(n+${from + 1}) img[data-file]`)) picture(state, u);
  for (const f of body.querySelectorAll(`.msd-u:nth-child(n+${from + 1}) .msd-fig:not(.msd-live):not(:has(img))`)) f.remove();
  // a figure's Enlarge: a quiet mark at its caption's end, beside the output's (an icon: the caption's words stay the text's own)
  for (const f of body.querySelectorAll(`.msd-u:nth-child(n+${from + 1}) .msd-fig[data-place]`)) {
    const cap = f.parentElement.querySelector(`.msd-cap[data-place="${CSS.escape(f.dataset.place)}"]`);
    if (cap && !cap.querySelector('[data-zoom]')) cap.insertAdjacentHTML('beforeend', `<button type="button" class="msd-out" data-zoom title="${esc(`Enlarge ${f.dataset.place}`)}" aria-label="${esc(`Enlarge ${f.dataset.place}`)}">${icon('full-size', { size: 12 })}</button>`);
  }
  decorateRefs(state, body, from);
  state.comments?.added(from);
  watchMore(state);
  if (state.query) highlight(state);
}
// the next part goes on the page as the reader nears the end of what is there
function watchMore(state) {
  state.io?.disconnect();
  const tail = state.el.querySelector('[data-doc-body] > .msd-more');
  if (!tail) return;
  state.io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) more(state, NEXT); }, { root: scrollerOf(state.el), rootMargin: '0px 0px 1600px 0px' });
  state.io.observe(tail);
}
function picture(state, img) {
  if (img.dataset.media) {
    const m = state.media.get(img.dataset.media);
    if (!m) { img.replaceWith(Object.assign(document.createElement('p'), { className: 'msd-note', textContent: 'This picture is not in the file.' })); return; }
    const u = URL.createObjectURL(new Blob([m.bytes], { type: m.mime || 'image/png' })); state.urls.push(u); img.src = u;
    return;
  }
  const path = img.dataset.file, mime = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
  activeFolder()?.read(path).then(bytes => {
    if (!img.isConnected) return;
    const u = URL.createObjectURL(new Blob([bytes], { type: mime })); state.urls.push(u); img.src = u;
  }, () => img.closest('figure')?.remove());
}

// ---- a figure drawn from its Lykos output ------------------------------------------------------------------------------------
// The output's definition, the figure's place and the rendered model: lib/live-figure.mjs (the Journal view draws the same charts).
/**
 * A figure whose caption names a Lykos chart takes the chart's place at once (its picture is not read) and is drawn when it scrolls near the
 * view, after the page is painted, one figure a task (3 Nov 2026: every chart of the main text was rendered before the first paint, each a fit
 * over the review's rows on the page's thread). A chart over a fitted synthesis waits for the worker's rows (lib/change-run.mjs).
 */
function liveFigureLater(state, fig) {
  const live = liveSpecOf(state, fig.dataset.place);
  if (!live) return false;
  // the file's picture is kept aside, unread: it stands in only when the chart cannot be drawn
  const img = fig.querySelector('img'); img?.remove();
  fig.classList.add('msd-live');
  fig.insertAdjacentHTML('afterbegin', '<div class="chart-svg msd-chart" data-live-wait></div>');
  fig._live = live; fig._img = img || null;
  if (!state.figIo) {
    state.figIo = new IntersectionObserver(es => { for (const x of es) if (x.isIntersecting) { state.figIo.unobserve(x.target); queueLive(state, x.target); } }, { root: scrollerOf(state.el), rootMargin: '0px 0px 800px 0px' });
    state.stops.push(() => state.figIo?.disconnect());
  }
  state.figIo.observe(fig);
  return true;
}
function queueLive(state, fig) {
  (state.figQueue ||= []).push(fig);
  if (state.figDrawing) return;
  state.figDrawing = (async () => {
    while (state.figQueue.length) {
      const f = state.figQueue.shift();
      if (cur !== state) break;
      if (!f.isConnected) continue;
      const from = f._live?.spec?.query?.from;
      if (from === 'syntheses' || from === 'effects') { try { await (await import('../lib/change-run.mjs')).changeReady(get(), from === 'syntheses' ? 'table' : 'effects'); } catch { /* fitted here */ } }
      if (cur !== state || !f.isConnected) continue;
      await breathe();
      if (cur !== state || !f.isConnected) continue;
      if (!liveFigure(state, f)) {
        // not drawable (no rows, a spec that does not render): the figure is its picture again, read now
        f.querySelector('[data-live-wait]')?.remove(); f.classList.remove('msd-live');
        if (f._img) { f.prepend(f._img); picture(state, f._img); } else f.remove();
        state.comments?.place();
      }
    }
    state.figDrawing = null;
  })();
}
/** The figure drawn from its chart, as Tables and figures draws it (the theme's colours); false when it cannot be. */
function liveFigure(state, fig) {
  const live = fig._live;
  if (!live) return false;
  let m;
  try { m = liveModelOf(live.id, live.spec); } catch { return false; }
  if (!m?.result?.rows?.length) return false;
  const host = fig.querySelector('[data-live-wait]') || fig.firstElementChild, style = figureTokens(null, { medium: 'screen' });
  host.removeAttribute('data-live-wait');
  // the marks answer as they do in Tables and figures: a card with the row's values, a study's name or row opens the study in the side
  // panel, a risk-of-bias judgement opens Appraisal at its domain; the caption's icon opens the output
  const press = wireChart(state, host, live, m);
  const paint = () => {
    const w = Math.round(host.clientWidth);
    if (!w || w === host._w) return;
    host._w = w;
    try { host.innerHTML = sanitizeSvg(chartSvg(m, { width: w, style })); host.querySelectorAll('[data-row] > title, [data-row] title').forEach(t => t.remove()); press.focusable(); } catch { host.textContent = ''; }
    state.comments?.place();
  };
  // drawn again at the width the column has (the width engine's measure, lib/ui-actions.mjs watchWidth)
  watchWidth(host, paint, { now: true });
  paint();
  return true;
}

/**
 * A drawn chart's marks answer as they do in Tables and figures: a card with the row's values, a study's name or row opens the study in the
 * side panel, a risk-of-bias judgement opens Appraisal at its domain, a mark of rows the studies; a mark that stands for no study opens the
 * output itself, where its rows are. Returns wireMarkPress's { focusable }.
 */
function wireChart(state, host, live, m) {
  const labelOf = id => { const p = (get().papers || []).find(x => x.id === id); return p?.label || p?.title || id; };
  wireMarkCard(host, m, { labelOf });
  const press = wireMarkPress(host, m, ({ ids, rob, domain, label }) => {
    host.closest('.msd-zoom')?.close();
    if (rob) { state.ctx?.openStudyResults?.('appraisal', ids[0], domain ? { domain } : undefined); return; }
    if (ids.length === 1) { closePop(); openRecord(state, ids[0]); return; }
    import('./library.mjs').then(lib => { lib.showSubset(ids, `${ids.length} studies, ${label}`); state.ctx?.go?.('library'); });
  });
  host.addEventListener('click', ev => {
    const row = ev.target.closest?.('[data-row]');
    if (!row || ev.target.closest('[data-study]') || (m.result.refs[Number(row.getAttribute('data-row'))] || []).length) return;
    host.closest('.msd-zoom')?.close();
    openOutput(state, live.id, live.title || '');
  });
  return press;
}

// ---- a figure enlarged ------------------------------------------------------------------------------------------------------------
// 7 Nov 2026, the owner: "interactive figures charts etc they are not fully interactive, check the sizes". A figure stands at the text's
// measure; Enlarge (the caption's mark, or a press on a picture) shows it over the window: a chart drawn again at that width with its marks
// answering as on the page, a picture at the width it fits, and a pinch or Command with the wheel zooms either. A popover in the top layer
// (a view composes no dialog, and the dialog helper's form tiers stop at 600 px): one head bar (its title and Close), the figure under it;
// Esc or a press outside it closes it.
function openZoom(state, fig) {
  const place = fig.dataset.place || fig.querySelector('img')?.alt || 'Figure', live = fig._live, img = fig.querySelector('img');
  if (!live && !img?.src) return;
  const d = document.createElement('div');
  d.className = 'msd-zoom'; d.popover = 'auto'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', place);
  d.innerHTML = `<div class="msd-zoom-top">${uiBar({ kind: 'head', label: place, lead: { title: place, level: 'h2' }, actions: [{ id: 'msd-zoom-close', label: 'Close', icon: 'close', role: 'quiet' }] })}</div><div class="msd-zoom-body"><div class="msd-zoom-fig"></div></div>`;
  document.body.append(d);
  const bodyEl = d.querySelector('.msd-zoom-body'), figEl = d.querySelector('.msd-zoom-fig');
  let zoom = 1;
  const stops = [];
  const done = ev => { if (ev.newState !== 'closed') return; for (const f of stops) { try { f(); } catch { /* released */ } } d.remove(); };
  d.addEventListener('toggle', done);
  d.close = () => d.hidePopover();
  d.querySelector('#msd-zoom-close').onclick = () => d.close();
  d.showPopover();
  if (live) {
    let m; try { m = liveModelOf(live.id, live.spec); } catch { m = null; }
    if (!m?.result?.rows?.length) { d.close(); return; }
    figEl.classList.add('chart-svg', 'msd-chart');
    const press = wireChart(state, figEl, live, m), style = figureTokens(null, { medium: 'screen' });
    const paint = () => { const w = Math.round(bodyEl.clientWidth - 32); if (!w || w === figEl._w) return; figEl._w = w; try { figEl.innerHTML = sanitizeSvg(chartSvg(m, { width: w, style })); figEl.querySelectorAll('[data-row] > title, [data-row] title').forEach(t => t.remove()); press.focusable(); } catch { figEl.textContent = ''; } };
    stops.push(watchWidth(bodyEl, paint, { now: true }));
    paint();
  } else {
    const copy = document.createElement('img');
    copy.src = img.src; copy.alt = img.alt; figEl.append(copy);
  }
  stops.push(pinchZoom(bodyEl, { live: true, min: 1, max: 4, get: () => zoom, set: next => { zoom = next; figEl.style.zoom = String(next); } }));
}

const scrollerOf = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; } return null; };
// the unit at the top of the reading area, to come back to after the file is read again
function topUnit(state) {
  const sc = scrollerOf(state.el), top = (sc?.getBoundingClientRect().top || 0) + 80;
  let at = 0;
  for (const u of state.el.querySelectorAll('.msd-u')) { if (u.getBoundingClientRect().top > top) break; at = +u.dataset.u; }
  return at;
}
function jump(state, unit, { smooth = true } = {}) {
  if (unit > state.rendered - 1) more(state, NEXT, unit + 2);
  const node = state.el.querySelector(`.msd-u[data-u="${unit}"]`);
  if (!node) return;
  node.scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}
// the outline marks the section being read
function watchScroll(state) {
  if (state.spy) state.scroller?.removeEventListener('scroll', state.spy);
  const sc = state.scroller = scrollerOf(state.el);
  if (!sc) return;
  let frame = 0;
  // a source shown beside a number stays where the number was: it goes when the text moves
  state.spy = () => { if (pop) closePop(); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    if (cur !== state) return;
    const list = state.model.outline, r = sc.getBoundingClientRect();
    const topOf = i => { if (list[i].unit >= state.rendered) return null; const n = state.el.querySelector(`.msd-u[data-u="${list[i].unit}"]`); return n ? n.getBoundingClientRect().top : null; };
    markOutline(state, readingK(state, sc, list.length, topOf, readingLine(r.top, sc.clientHeight), state.rendered >= state.model.units.length));
  }); };
  sc.addEventListener('scroll', state.spy, { passive: true });
  state.spy();
}

// ---- the Word view ----------------------------------------------------------------------------------------------------------
// The file's pages as Files shows a Word file (views/file-doc.mjs): its tools bar (zoom, fit, Edit text, Save), editing saved paragraph by
// paragraph and refused over a copy changed on disk. The outline goes to each block's place on the pages (data-bi, lib/docx-pages.mjs).
function mountWord(state) {
  const host = state.el.querySelector('[data-word]');
  if (!host) return;
  state.layout = null;
  state.inst = mountDocument(host, {
    rel: state.doc.file, folder: activeFolder(), ctx: state.ctx,
    say: text => { const p = state.el.querySelector('[data-state]'); if (p && text) { p.textContent = text; p.hidden = false; p.dataset.tone = /refused|Changed on disk|could not|read-only/i.test(text) ? 'stopped' : ''; } },
    word: { laidOut: api => laidOut(state, api), saved: bytes => savedWord(state, bytes), beforeEdit: () => beforeEdit(state) },
  });
}
function remountWord(state) { state.inst?.release(); mountWord(state); }
function laidOut(state, { layout, viewport, result }) {
  if (cur !== state) return;
  Object.assign(state, { layout, viewport, wordRefs: referencesOf(result.doc?.blocks), wordRecords: new Map((result.doc?.records || []).map(r => [r.key, r])) });
  layout.querySelectorAll('.tok.cite[data-keys]').forEach(c => { c.tabIndex = 0; });
  wireDoc(state, layout);
  if (state.spy) state.scroller?.removeEventListener('scroll', state.spy);
  state.scroller = viewport;
  let frame = 0;
  state.spy = () => { if (pop) closePop(); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    if (cur !== state || !state.model) return;
    const list = state.model.outline;
    const topOf = i => { const n = layout.querySelector(`[data-bi="${list[i].block ?? 0}"]`); return n ? n.getBoundingClientRect().top : null; };
    markOutline(state, readingK(state, viewport, list.length, topOf, readingLine(viewport.getBoundingClientRect().top, viewport.clientHeight), true));
  }); };
  viewport.addEventListener('scroll', state.spy, { passive: true });
  if (state.query) search(state, state.query);
}
function jumpWord(state, block) {
  const v = state.viewport, n = state.layout?.querySelector(`[data-bi="${block}"]`);
  if (!v || !n) return;
  v.scrollTop += n.getBoundingClientRect().top - v.getBoundingClientRect().top - 24;
}
// A registered manuscript is built by the project's own build: an edit here is lost when the build writes the file again. Edit text says so
// first, once per file while the app is open, and offers what the build reads (the registration's sources, lykos-register --sources).
const editAgreed = new Set();
async function beforeEdit(state) {
  const file = state.doc.file;
  if (editAgreed.has(file)) return true;
  const e = state.e, src = (e?.sources || [])[0] || '';
  const answer = await choiceAsk('The next build replaces this file', {
    detail: `${base(file)} is made by the project's build. An edit made here is lost when the build writes it again${src ? `, unless it is made in ${base(src)}, which the build reads` : ''}.`,
    choices: src ? [{ id: 'source', label: 'Edit the source', role: 'primary' }, { id: 'anyway', label: 'Edit anyway' }] : [{ id: 'anyway', label: 'Edit anyway', role: 'primary' }] });
  if (answer === 'source') { (await import('./files.mjs')).show(src); state.ctx?.go?.('files'); return false; }
  if (answer !== 'anyway') return false;
  editAgreed.add(file);
  return true;
}

/** An edit saved in the Word view: the registration records it as the owner's own, with the file's words counted again. */
async function savedWord(state, bytes) {
  const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  const at = new Date().toISOString(), file = state.doc.file;
  let counts = null;
  if (state.doc.key === 'manuscript') { try { const c = structureCounts((await parseDocx(bytes)).blocks); counts = { words: c.main.words, abstractWords: c.abstract?.words || 0, sections: c.main.sections.map(x => ({ name: x.name, words: x.words })) }; } catch { /* counted on the next read */ } }
  update(s => {
    const e = s.externalOutputs?.manuscript;
    if (!e) return s;
    const edited = { at, by: 'You', sha256: sum, size: bytes.length };
    if (e.file === file) Object.assign(e, counts || {}, { edited });
    else for (const f of e.files || []) if (f.file === file) f.edited = edited;
    return s;
  });
  // the outline and the counts read the saved file; the folder's watch then finds it unchanged
  const r = await load(state.e, state.doc);
  if (cur === state && !r.error) drawSide(state, r);
}
/** Before another file or view is shown: unsaved edits in the Word view are saved, or left behind when the owner says so. False: stay. */
export async function leave() {
  if (!cur?.inst?.dirty?.()) return true;
  const go = await confirmAsk('Save your edits first?', { detail: `${base(cur.doc.file)} has edits that are not saved.`, confirm: 'Save' });
  if (go) return await cur.inst.save();
  return confirmAsk('Leave without saving?', { detail: 'The edits are lost.', confirm: 'Leave', danger: true });
}

// ---- search -----------------------------------------------------------------------------------------------------------------
function drawFind(state) {
  const host = state.el.querySelector('[data-find]');
  if (!host) return;
  host.hidden = !state.findOpen;
  if (!state.findOpen) return;
  if (!host.firstChild) {
    host.innerHTML = uiBar(findBarSpec({ id: 'msd-find', label: `Find in the ${state.doc.label.toLowerCase()}`, field: 'msd-find-q', count: 'msd-find-count', ch: 12, value: state.query,
      steps: { prevKbd: '⇧↵', nextKbd: '↵' } }));
    const q = host.querySelector('#msd-find-q');
    let t = 0;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => search(state, q.value), 120); };
    q.onkeydown = ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); step(state, ev.shiftKey ? -1 : 1); }
      if (ev.key === 'Escape') { ev.preventDefault(); closeFind(state); }
    };
    host.querySelector('#msd-find-next').onclick = () => step(state, 1);
    host.querySelector('#msd-find-prev').onclick = () => step(state, -1);
    host.querySelector('#msd-find-close').onclick = () => closeFind(state);
  }
  countText(state);
}
function closeFind(state) {
  state.findOpen = false; search(state, '');
  const host = state.el.querySelector('[data-find]'); if (host) { host.hidden = true; host.innerHTML = ''; }
  state.ctx?.chrome?.();
}
function countText(state) {
  const c = state.el.querySelector('#msd-find-count');
  if (c) c.textContent = !state.query ? '' : state.hits.length ? `${state.at + 1} of ${state.hits.length.toLocaleString('en')}` : 'No matches';
}
// every match in the document's text, unit by unit, whether or not the unit is on the page yet
function search(state, q) {
  state.query = String(q || '').trim();
  state.hits = []; state.at = -1;
  if (state.mode === 'word') {
    // the pages are on the page whole: every match is a range of them
    if (state.query && state.layout) state.hits = rangesIn(state.layout, state.query.toLocaleLowerCase()).map(r => ({ r }));
    if (state.hits.length) state.at = 0;
  } else if (state.query && state.model) {
    const needle = state.query.toLocaleLowerCase();
    state.model.units.forEach((u, k) => { const t = u.text.toLocaleLowerCase(); for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) state.hits.push({ unit: k, n: 0 }); });
    const seen = new Map(); for (const h of state.hits) { h.n = seen.get(h.unit) || 0; seen.set(h.unit, h.n + 1); }
    if (state.hits.length) state.at = 0;
  }
  highlight(state); countText(state);
  if (state.at >= 0) show(state);
}
function step(state, by) {
  if (!state.hits.length) return;
  state.at = (state.at + by + state.hits.length) % state.hits.length;
  highlight(state); countText(state); show(state);
}
// the ranges of the query in a unit on the page, across its runs
function rangesIn(node, needle) {
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), parts = [];
  let all = '';
  for (let t = walk.nextNode(); t; t = walk.nextNode()) { parts.push({ t, at: all.length }); all += t.data; }
  const lower = all.toLocaleLowerCase(), out = [];
  const where = i => { let p = parts[0]; for (const x of parts) { if (x.at > i) break; p = x; } return [p.t, i - p.at]; };
  for (let i = lower.indexOf(needle); i >= 0 && needle; i = lower.indexOf(needle, i + needle.length)) {
    const r = document.createRange(), [a, ao] = where(i), [b, bo] = where(i + needle.length - 1);
    r.setStart(a, ao); r.setEnd(b, bo + 1); out.push(r);
  }
  return out;
}
function highlight(state) {
  const H = globalThis.CSS?.highlights;
  if (!H) return;
  H.delete('msd-find'); H.delete('msd-find-now');
  if (!state.query || !state.hits.length) return;
  if (state.mode === 'word') { H.set('msd-find', new Highlight(...state.hits.map(h => h.r))); const now = state.hits[state.at]; if (now) H.set('msd-find-now', new Highlight(now.r)); return; }
  const needle = state.query.toLocaleLowerCase(), all = [];
  for (const u of state.el.querySelectorAll('.msd-u')) all.push(...rangesIn(u, needle));
  if (all.length) H.set('msd-find', new Highlight(...all));
  const now = state.hits[state.at], node = now && state.el.querySelector(`.msd-u[data-u="${now.unit}"]`);
  const r = node && rangesIn(node, needle)[now.n];
  if (r) H.set('msd-find-now', new Highlight(r));
}
function show(state) {
  const h = state.hits[state.at];
  if (!h) return;
  if (state.mode === 'word') {
    highlight(state);
    const box = h.r.getBoundingClientRect(), v = state.viewport;
    if (v) { const top = v.getBoundingClientRect().top; if (box.top < top + 40 || box.bottom > top + v.clientHeight - 40) v.scrollTop += box.top - top - v.clientHeight / 3; }
    return;
  }
  if (h.unit > state.rendered - 1) more(state, NEXT, h.unit + 1);
  const node = state.el.querySelector(`.msd-u[data-u="${h.unit}"]`), r = node && rangesIn(node, state.query.toLocaleLowerCase())[h.n];
  highlight(state);
  const box = (r || node)?.getBoundingClientRect(), sc = scrollerOf(state.el);
  if (box && sc) { const top = sc.getBoundingClientRect().top; if (box.top < top + 60 || box.bottom > top + sc.clientHeight - 40) sc.scrollTop += box.top - top - sc.clientHeight / 3; }
  if (!globalThis.CSS?.highlights && r) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
}

// ---- where a number came from ------------------------------------------------------------------------------------------------
let pop = null, popTimer = 0;
function closePop() { clearTimeout(popTimer); pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); }
// what shows a card: a checked number, a citation of the reading page or of the Word view's pages
const MARK = '.msd-num, .msd-cite[data-refs], .msd-cite[data-keys], .tok.cite[data-refs], .tok.cite[data-keys]';
const outside = ev => { if (pop && !pop.contains(ev.target) && !ev.target.closest?.(MARK)) closePop(); };
const escape = ev => { if (ev.key === 'Escape') closePop(); };

// A mark shows its card on hover (after a moment), on focus, or pressed (then it stays until Esc or a press elsewhere); nothing moves.
function wireDoc(state, body) {
  // in the App view the marks' card (views/manuscript-comments.mjs) shows a number's source and a citation's entries, level with the line;
  // this popover serves until it is mounted, and in the Word view
  const card = () => state.comments && state.mode !== 'word';
  body.onpointerover = ev => {
    const n = ev.target.closest?.(MARK);
    if (!n || pop?.dataset.pinned || card()) return;
    clearTimeout(popTimer); popTimer = setTimeout(() => openPop(state, n, false), 250);
  };
  body.onpointerout = ev => { if (ev.target.closest?.(MARK) && !pop?.dataset.pinned && !card()) { clearTimeout(popTimer); popTimer = setTimeout(() => { if (!pop?.matches(':hover') && !pop?.dataset.pinned) closePop(); }, 200); } };
  body.onfocusin = ev => { const n = ev.target.closest?.(MARK); if (n && !pop?.dataset.pinned && !card()) openPop(state, n, false); };
  body.onkeydown = ev => {
    if (ev.key === 'Enter' && ev.target.matches?.('.msd-ref[data-ref]')) { ev.preventDefault(); closePop(); openRef(state, ev.target.dataset.ref); return; }
    const n = (ev.key === 'Enter' || ev.key === ' ') && !card() && ev.target.closest?.(MARK); if (n) { ev.preventDefault(); openPop(state, n, 'key'); }
  };
  body.onclick = ev => {
    const d = ev.target.closest?.('.msd-ref [data-doi]');
    if (d) { const u = doiUrl(d.dataset.doi); if (u) openLink(u).catch(() => {}); return; }
    const rf = ev.target.closest?.('.msd-ref[data-ref]');
    if (rf) { closePop(); openRef(state, rf.dataset.ref); return; }
    const n = ev.target.closest?.(MARK);
    if (n) { if (!card()) openPop(state, n, true); return; }
    const o = ev.target.closest?.('[data-out]');
    if (o) { openOutput(state, o.dataset.out, o.dataset.title); return; }
    const z = ev.target.closest?.('[data-zoom]'), cap = z?.closest('.msd-cap');
    const fig = z ? cap?.parentElement.querySelector(`.msd-fig[data-place="${CSS.escape(cap.dataset.place)}"]`) : ev.target.closest?.('.msd-fig:not(.msd-live)');
    if (fig) openZoom(state, fig);
  };
}
async function resultsOf(state) {
  if (state.results !== null && state.results !== undefined) return state.results;
  const file = state.stale.analysis?.file;
  state.results = file ? ((await readOnce(activeFolder(), file, b => resultsIndex(text(b))).catch(() => ({}))).value || []) : [];
  return state.results;
}
async function openPop(state, n, pinned) {
  const cite = !n.classList.contains('msd-num');
  const info = cite ? null : state.model?.numbers[+n.dataset.n];
  if (!cite && !info) return;
  if (pop && pop._for === n) { if (pinned) pop.dataset.pinned = '1'; return; }
  closePop();
  const p = pop = document.createElement('div');
  p.className = 'msd-pop'; p._for = n;
  p.setAttribute('aria-label', cite ? 'Cited references' : 'Source of this number');
  if (pinned) p.dataset.pinned = '1';
  p.innerHTML = cite ? citeCard(state, n) : await cardHtml(state, info);
  if (!p.innerHTML) { pop = null; return; }
  if (pop !== p) return;
  document.body.append(p);
  const r = n.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  p.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  p.onpointerleave = () => { if (!p.dataset.pinned) closePop(); };
  p.onclick = ev => { if (markAct(state, ev.target)) closePop(); };
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
  if (pinned === 'key') p.querySelector('button')?.focus({ preventScroll: true });
}
/** A press inside a number's or a citation's words (the popover, or the marks' card): its output, reference, record or DOI opened; false when none. */
function markAct(state, t) {
  const o = t.closest?.('[data-out]'); if (o) { openOutput(state, o.dataset.out, o.dataset.title); return true; }
  // a value's page in its paper (the proof chain): the PDF opens at the page, its quote marked
  const pdf = t.closest?.('[data-pdf]'); if (pdf) { openPage(state, pdf.dataset.pdf, Number(pdf.dataset.at) || 1, pdf.dataset.quote || ''); return true; }
  const ref = t.closest?.('[data-ref]'); if (ref) { openRef(state, ref.dataset.ref); return true; }
  const lib = t.closest?.('[data-paper]'); if (lib) { openRecord(state, lib.dataset.paper); return true; }
  const doi = t.closest?.('[data-doi]'); if (doi) { const u = doiUrl(doi.dataset.doi); if (u) openLink(u).catch(() => {}); return true; }
  return false;
}
async function cardHtml(state, info) {
  const { row } = info, kind = sourceKind(row.source), ck = row.check;
  const stale = ck && state.stale.flags.rows ? state.stale.flags.rows.has(ck.n) : staleKind(row.source, state.stale.flags);
  const lines = [];
  if (kind.kind === 'results') {
    const line = resultLine(await resultsOf(state), row.number, info.near);
    const file = state.stale.analysis?.file || 'results.md';
    lines.push(line ? `<p class="msd-pop-title">${esc(line.section || 'Analysis results')}</p><p class="msd-pop-line">${esc(line.text)}</p>` : `<p class="msd-pop-title">Analysis results</p>`);
    lines.push(`<p class="msd-pop-src">${esc(file)}${/^Derived/.test(row.source) ? `; ${esc(row.source)}` : ''}</p>`);
    if (ck?.source?.run) lines.push(`<p class="msd-pop-src">${esc(`Run ${ck.source.run}: ${ck.source.outputs.join(', ')}`)}</p>`);
    if (stale) lines.push(`<p class="msd-pop-stale">${esc(ck ? `Rests on ${state.stale.flags.rows.get(ck.n)}` : `Data changed after this analysis ran: ${state.stale.analysis?.after?.text || 'values written'}`)}</p>`);
  } else if (kind.kind === 'output') {
    const o = [...state.stale.outputs.values()].find(x => x.id === kind.id), title = o?.title || kind.id;
    lines.push(`<p class="msd-pop-title">${esc(title)}</p><p class="msd-pop-src">${esc(row.source)}</p>`);
    if (o?.stale) lines.push(`<p class="msd-pop-stale">${esc(o.staleText)}</p>`);
    lines.push(`<p class="msd-pop-act"><button type="button" class="msd-out" data-out="${esc(kind.id)}" data-title="${esc(title)}">Open in Tables and figures</button></p>`);
  } else {
    const cut = row.source.indexOf(' ('), name = cut > 0 ? row.source.slice(0, cut) : row.source;
    lines.push(`<p class="msd-pop-title">${esc(name)}</p>${cut > 0 ? `<p class="msd-pop-src">${esc(row.source.slice(cut + 2, -1))}</p>` : ''}`);
    if (ck?.source?.valueIds) lines.push(`<p class="msd-pop-src">${esc(`Values: ${ck.source.valueIds.slice(0, 4).join(', ')}${ck.source.valueIds.length > 4 ? ` and ${ck.source.valueIds.length - 4} more` : ''}`)}</p>`);
    if (stale) lines.push(`<p class="msd-pop-stale">${esc(ck ? `Rests on ${state.stale.flags.rows.get(ck.n)}` : `Data changed since the manuscript was built: ${state.stale.record}`)}</p>`);
  }
  // the number check as data: where the number stands and what the check made of its source
  if (ck) {
    if (ck.status !== 'matched') lines.push(`<p class="msd-pop-stale">${esc({ ambiguous: 'The source holds this number in more than one place', unmatched: 'The source named does not hold this number', unplaced: 'Not found in the file' }[ck.status] || ck.status)}</p>`);
    const where = placeText(ck.place); if (where) lines.push(`<p class="msd-pop-src">${esc(where)}</p>`);
    lines.push(await chainHtml(state, ck).catch(() => ''));
  }
  return lines.join('');
}

// ---- the proof chain of a number (plan W9c 6; spec "Proven links") ----------------------------------------------------------------
// Made when the number's card opens, never before: the run output it came from, the values that output reads (the first eight, each with
// its study and value), each value's proof as the checker found it (.lykos/proofs/state.json.gz, lib/proof-state.mjs; the words of
// lib/proof/reconcile.mjs) and the passage that proves it, its page opening the paper there (lib/proof-chain.mjs).
/** A recorded run the check names (its run.json, read once a reader): its outputs' titles and texts. */
async function runOf(state, id) {
  state.runs ||= new Map();
  if (!state.runs.has(id)) {
    const file = state.src?.check?.runs?.[id]?.file;
    // its outputs' titles and texts only: lib/analysis-run.mjs readRun would load the change synthesis with it
    const runOnly = b => { const r = json(b); return r?.kind === 'lykos-run' && Array.isArray(r.outputs) ? r : null; };
    state.runs.set(id, file ? readOnce(activeFolder(), file, runOnly).then(r => r?.value || null, () => null) : Promise.resolve(null));
  }
  return state.runs.get(id);
}
async function chainHtml(state, ck) {
  const check = state.src?.check, src = ck.source || {};
  if (!(src.run && src.outputs?.length && check?.runs?.[src.run]) && !src.valueIds?.length) return '';
  const s = get(), [run, proofs] = await Promise.all([src.run ? runOf(state, src.run) : null, proofStateReady().catch(() => null)]);
  const c = proofChain(ck, { check, run, s, proofs, names: new Map(fields(s).map(f => [f.id, f.label])) });
  if (!c) return '';
  const o = c.output, head = o ? `${o.title}${o.level ? `, ${o.level}` : ''}${o.text ? `: ${o.text}` : ''}` : '';
  const rows = c.values.map(v => {
    const quote = v.quote.length > 90 ? `${v.quote.slice(0, 89)}…` : v.quote;
    const open = v.page ? ` <button type="button" class="msd-out" data-pdf="${esc(v.pid)}" data-at="${v.page}"${v.quote ? ` data-quote="${esc(v.quote)}"` : ''}>${esc(`p. ${v.page}`)}</button>` : '';
    return `<p class="msd-pop-line">${esc(`${v.study}, ${v.field}: ${v.value || 'no value'}`)}</p><p class="msd-pop-src">${esc(`${v.status}${quote ? `; “${quote}”` : ''}`)}${open}</p>`;
  });
  return `<p class="msd-pop-title">Rests on</p>${head ? `<p class="msd-pop-line">${esc(head)}</p>` : ''}${rows.join('')}`
    + (c.total > CHAIN_MAX ? `<p class="msd-pop-src">${esc(`and ${c.total - CHAIN_MAX} more values`)}</p>` : '');
}
async function openPage(state, id, page, quote) {
  const { openStudy } = await import('../lib/study.mjs');
  if (state.ctx?.openDocument || state.ctx?.showStudy) await openStudy(state.ctx, id, { page, rects: [], quote });
  else openRecord(state, id);
}

// ---- what a citation cites ----------------------------------------------------------------------------------------------------
// The project's records by DOI and by title, to open a cited work's own record (built once per page).
let paperIndex = null;
/** The project record a reference is: by DOI, else PMID, else title (lib/docx-reading.mjs referenceRecord). The library is prepared once per change of the papers. */
function paperOf(entry) {
  const papers = get().papers || [];
  if (!paperIndex || paperIndex.papers !== papers || paperIndex.n !== papers.length) paperIndex = { papers, n: papers.length, lib: prepareLibrary(papers, { exact: true }) };
  return referenceRecord(entry, paperIndex.lib);
}
/** The reference list's entries that are project records open their details in the side panel; every entry with a DOI keeps Open DOI, and the number of citations that name it shows. */
function decorateRefs(state, body, from) {
  const refs = state.model?.refs;
  if (!refs?.size) return;
  for (const row of body.querySelectorAll(`.msd-u:nth-child(n+${from + 1}) .msd-ref`)) {
    const num = row.querySelector('.msd-ref-n'), key = num ? num.textContent.replace(/\.$/, '') : '', e = refs.get(key);
    if (!e) continue;
    const text = document.createElement('span'); text.className = 'msd-ref-body';
    while (num.nextSibling) text.append(num.nextSibling);
    const count = state.model.cited?.get(key) || 0, doi = cleanDoi(e.doi || ''), id = paperOf(e);
    const end = document.createElement('span'); end.className = 'msd-ref-end';
    end.innerHTML = `${count ? `<span class="msd-ref-cites">${count} ${count === 1 ? 'citation' : 'citations'}</span>` : ''}${doi ? `<button type="button" class="msd-out" data-doi="${esc(doi)}" title="Open DOI" aria-label="${esc(`Open DOI of reference ${key}`)}">${icon('globe', { size: 14 })}</button>` : ''}`;
    text.append(end);
    row.append(text);
    if (id) row.dataset.paper = id;
    row.dataset.ref = key; row.tabIndex = 0; row.title = 'Open details';
  }
}
const recordLine = r => [[(r.authors || []).slice(0, 3).map(a => String(a).split(',')[0]).join(', ') + ((r.authors || []).length > 3 ? ', et al' : ''), r.title].filter(Boolean).join('. '), [r.journal, r.year].filter(Boolean).join(' ')].filter(Boolean).join('. ');
/** The card of a citation: each entry it names, as the reference list gives it, with its record in the library or its DOI. */
function citeCard(state, n) {
  const refs = state.mode === 'word' ? state.wordRefs : state.model?.refs, records = state.mode === 'word' ? state.wordRecords : state.model?.records;
  const items = [];
  for (const k of (n.dataset.refs || '').split(' ').filter(Boolean)) { const x = refs?.get(k); if (x) items.push({ ...x, n: k }); }
  // a citation field names records: each as its entry of the reference list (by its DOI), else as the record says
  if (!items.length) for (const k of (n.dataset.keys || '').split(' ').filter(Boolean)) {
    const r = records?.get(k); if (!r) continue;
    const d = cleanDoi(r.doi || '').toLowerCase(), x = d && [...(refs?.values() || [])].find(e => cleanDoi(e.doi || '').toLowerCase() === d);
    items.push(x ? { ...x, n: x.key } : { n: '', text: recordLine(r), doi: r.doi || '', title: r.title || '', pmid: r.pmid || '', year: r.year || '' });
  }
  if (!items.length) return '';
  return items.map(x => {
    const id = paperOf(x), doi = cleanDoi(x.doi || ''), text = x.text.replace(/\s*(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)\S+$/i, '').replace(/\s*PMID:?\s*\d+\.?$/i, '');
    const act = [x.n ? `<button type="button" class="msd-out" data-ref="${esc(x.n)}">${icon('inspector', { size: 14 })}Open details</button>` : id ? `<button type="button" class="msd-out" data-paper="${esc(id)}">${icon('inspector', { size: 14 })}Open details</button>` : '', doi ? `<button type="button" class="msd-out" data-doi="${esc(doi)}">${icon('globe', { size: 14 })}Open DOI</button>` : ''].join('');
    return `<div class="msd-pop-ref">${x.n ? `<span class="msd-pop-n">${esc(x.n)}</span>` : '<span></span>'}<div><p class="msd-pop-line">${esc(text)}</p>${act ? `<p class="msd-pop-act">${act}</p>` : ''}</div></div>`;
  }).join('');
}
/** A cited work's record in the side panel, the one a study opens in from a table or a figure (lib/study.mjs openStudy). */
async function openRecord(state, id) {
  const { openStudy } = await import('../lib/study.mjs');
  if (state.ctx?.showStudy) await openStudy(state.ctx, id);
  else { const lib = await import('./library.mjs'); lib.focusPaper?.(id); state.ctx?.go?.('library'); }
}

// ---- a reference in the side panel -----------------------------------------------------------------------------------------------
let refPanel = null;   // views/manuscript-reference.mjs, loaded with the first reference opened
let shownRef = null;   // { file, key }: the reference open in the side panel; kept across a repaint of the page (the reader is mounted again)
/** Opens reference `key` ("8", "e12") of the file shown in the side panel: its uses in the text first. */
async function openRef(state, key) {
  if (!state.model?.refs?.has(key)) return;
  refPanel ||= await import('./manuscript-reference.mjs');
  if (cur !== state) return;
  shownRef = { file: state.doc.file, key };
  state.ctx?.openDetails?.();
  state.ctx?.refreshDetails?.();
}
function closeRef(state) { shownRef = null; markCite(state, '', -1); state.ctx?.refreshDetails?.(); }
/** The side panel's section for the reference open in the reader, or null (views/manuscript.mjs inspect draws it first). */
export function inspectReference(ctx) {
  const state = cur, key = shownRef && state?.doc?.file === shownRef.file ? shownRef.key : '';
  if (!key || !state.model?.refs?.has(key) || !refPanel) return null;
  const entry = state.model.refs.get(key), id = entry && paperOf(entry), record = id ? (get().papers || []).find(x => x.id === id) || null : null;
  return refPanel.referenceSection(state, key, { record,
    onJump: use => { if (state.mode === 'word') return; jump(state, use.unit); markCite(state, key, use.unit); },
    onOpen: pid => openRecord(state, pid),
    onClose: () => closeRef(state),
    redraw: () => { if (cur === state && shownRef?.key === key) ctx?.refreshDetails?.(); } });
}
// the citation jumped to keeps a fill until another is, or the reference is closed
function markCite(state, key, unit) {
  state.el.querySelectorAll('.msd-cite.on').forEach(n => n.classList.remove('on'));
  if (!key || unit < 0) return;
  const n = [...state.el.querySelectorAll(`.msd-u[data-u="${unit}"] .msd-cite[data-refs]`)].find(c => c.dataset.refs.split(' ').includes(key));
  if (n) { n.classList.add('on'); n.scrollIntoView({ block: 'center', behavior: 'auto' }); }
}

/** Tables and figures, on the output a caption or a number names: its own page when the project holds it, else its list filtered to it. */
async function openOutput(state, id, title) {
  const o = await import('./outputs.mjs');
  const own = outputById(get(), id);
  if (own && currentSpec(own)) o.openOutput(id); else { o.setFilter(title || id); o.openList(); }
  state.ctx?.go?.('outputs');
}

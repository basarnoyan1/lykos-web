// The DOI to Mendeley page (cite.html): a Word document's DOI markers become Mendeley Cite citations, or its Mendeley citations
// become DOI markers again. Everything happens in the browser; the only requests are Crossref and doi.org for the works' data.
// The converting is lib/doi-cite.mjs; this file draws the page and keeps its state. The page opens with the bars and icons only: the
// converter (and its reference parser) loads when the page is idle, or at once when a file comes first; the exporters when asked for.
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { fitSplit, fitSteps } from '../lib/split-fit.mjs';
import { lib_dates$plural as plural } from "../boot.mjs";
import "../boot.mjs";
import "../boot.mjs";

let C = null, coreLoad = null;
const core = () => (coreLoad ||= import('../lib/doi-cite.mjs').then(m => (C = m)));
(window.requestIdleCallback || (f => setTimeout(f, 300)))(() => core());
// lib/ui-components.mjs's formField and tableRegion, written here so the page does not load that module's pickers and pager
const formField = (label, control) => `<label class="field ui-field"><span>${esc(label)}</span>${control}</label>`;
const tableRegion = ({ label, html }) => `<div class="ui-table-region" role="region" aria-label="${esc(label)}" tabindex="0">${html}</div>`;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KEEP = 'lykos.cite.options';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEEP) || '{}'); } catch { return {}; } })();
const S = {
  name: '', pkg: null, doc: '', scan: null, mode: 'convert', view: 'changes', busy: '', error: '',
  works: new Map(),          // doiKey -> { csl, source, fixed, filled, issues, notices, listCsl } or { missing: true }
  fromList: new Set(),       // doiKeys whose work is taken from the typed list instead of the registry
  merged: new Set(),         // duplicate pairs ("a|b") the person chose to cite as one work (a PubMed id and its DOI are one without asking)
  result: null,
  opts: { journal: null, numbers: 'sup', style: 'ama', brackets: 'round', prefix: 'any', separator: 'any', refs: 'auto', heading: 'References', punctuation: 'move', fill: 'list', ...saved },
};
const styleArg = () => (S.opts.journal ? C.journalStyle(S.opts.journal, S.opts.numbers) : S.opts.style);
const marker = () => ({ brackets: S.opts.brackets, prefix: S.opts.prefix, separator: S.opts.separator });
const $ = id => document.getElementById(id);

// ---- work -----------------------------------------------------------------------------------------------------------------------
// A document's turn: lookups, suggestions, details and page layouts begun for one file stop at their next step once another is opened
// or the page is cleared (they compare the turn they began in with this one), so one file's answers never land in the next one's state.
let gen = 0;
/** Lets the open document go: its pages (and their pictures' object URLs), bytes and per-document choices. */
function clearDoc({ turn = true } = {}) {
  if (turn) gen++;
  dropPaper(papers.old); dropPaper(papers.new); papers.old = papers.new = null;
  paperBytes = { version: -1, bytes: null }; pubmed.clear();
  Object.assign(S, { bytes: null, note: '', detail: null, fromList: new Set(), merged: new Set(), dups: [], works: new Map(), result: null });
}
async function open(file) {
  S.error = ''; S.busy = 'Reading';
  draw();
  const my = ++gen;
  try {
    const { openDocx } = await core();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pkg = await openDocx(bytes);
    if (my !== gen) return;
    clearDoc({ turn: false });   // this open is the turn
    Object.assign(S, { bytes, name: file.name, pkg, doc: pkg.text('word/document.xml') });
    rescan();
  } catch (e) { if (my !== gen) return; S.error = /zip|Word/i.test(e.message) ? 'This file is not a Word document (.docx).' : e.message; S.pkg = null; }
  S.busy = '';
  draw();
  lookUp();
}
function rescan() {
  S.scan = C.scanDocument(S.doc, { marker: marker() });
  // a file already cited with Mendeley Cite opens as it is ('cited': its pages and its works); it goes back to DOI markers ('revert') only
  // when the person asks (Turn back into DOI markers). Choosing the reverse direction on its own read as the tool working backwards.
  S.mode = !S.scan.markers.length && S.scan.mendeley.length ? (S.mode === 'revert' ? 'revert' : 'cited') : 'convert';
  if (S.mode !== 'convert') for (const c of S.scan.mendeley) for (const it of c.items) if (it.DOI && !S.works.has(C.doiKey(it.DOI))) S.works.set(C.doiKey(it.DOI), { csl: it, source: 'Mendeley' });
  rebuild();
}
/** The works' CSL as the converter takes it: the registry's, repaired and completed from the typed list as chosen, or the typed entry
 * itself for a work whose source was set to the list. */
function cslMap() {
  const out = new Map();
  for (const [k, w] of S.works) { const c = usedCsl(k, w); if (c) out.set(k, c); }
  return out;
}
const usedCsl = (k, w) => (S.fromList.has(k) && w?.listCsl ? w.listCsl : w?.csl);
// The registries' answers are kept in this browser for 30 days, by DOI: a document opened again, or its next version, needs no lookup
// for the works it already cited. Only answers are kept (a DOI no registry knew is asked again).
const WORKS_KEY = 'lykos.cite.works', WORKS_DAYS = 30;
const cached = (() => { try { return JSON.parse(localStorage.getItem(WORKS_KEY) || '{}'); } catch { return {}; } })();
// The cache holds what a citation needs, not what the details read (abstracts, PubMed's record): those are asked again when a work's details
// open, so 2000 works stay well under the browser's 5 MB. It is written once the answers stop coming, not once per answer.
let saveTimer = 0;
function remember(k, w) {
  const meta = w.meta ? { ...w.meta, abstract: '', lite: true } : null;
  cached[k] = { w: { csl: w.csl, source: w.source, notices: w.notices || [], meta }, at: Date.now() };
  clearTimeout(saveTimer); saveTimer = setTimeout(saveCache, 500);
}
function saveCache() {
  const keys = Object.keys(cached); if (keys.length > 2000) keys.sort((a, b) => cached[a].at - cached[b].at).slice(0, keys.length - 2000).forEach(x => delete cached[x]);
  try { localStorage.setItem(WORKS_KEY, JSON.stringify(cached)); } catch {}
}
const fresh = k => cached[k] && Date.now() - cached[k].at < WORKS_DAYS * 864e5 ? cached[k].w : null;
function settle(d, w) { S.works.set(C.doiKey(d), workOf(d, w)); }
function workOf(d, w) {
  const k = C.doiKey(d), entry = C.entryFor(S.scan, k, w?.csl);
  // no registry knows it: the typed list's entry stands in, read as fields, so the citation still carries a work
  if (!w) return entry ? { csl: C.cslFromEntry(entry, C.cleanDoi(d)), source: 'Your list', unknown: true, entry, fixed: [], filled: [], issues: [], notices: [] } : { missing: true };
  const { csl: repaired, fixed } = C.repairCsl(w.csl, entry);
  const { csl, filled } = S.opts.fill === 'list' ? C.fillFromEntry(repaired, entry) : { csl: repaired, filled: [] };
  // NLM's abbreviation: for every work ('nlm'), or for those the typed list does not abbreviate ('list')
  const abbr = S.opts.fill !== 'registry' && (S.opts.fill === 'nlm' || !filled.includes('journal')) ? C.nlmAbbr(nlm, csl['container-title']) : '';
  if (abbr) csl['container-title-short'] = abbr;
  return { csl, raw: w.csl, source: w.source, entry, fixed, filled, issues: C.checkEntry(entry, csl), notices: w.notices || [], meta: w.meta || null, listCsl: entry ? C.cslFromEntry(entry, csl.DOI || C.cleanDoi(d)) : null };
}
/**
 * A DOI no registry knows, or whose record is another work than the typed entry: Crossref is searched with the entry's words, and an
 * answer the entry agrees with is offered (w.suggest); it is used only when the person says so. One request each, after the lookups.
 */
async function suggestAll() {
  const my = gen, todo = [...S.works].filter(([k, w]) => w.entry && !C.isPmid(k) && !w.suggest && !w.replaced && (w.unknown || (w.issues || []).some(i => i.kind === 'ref-wrong-id')));
  let done = 0, found = 0;
  for (const [k, w] of todo) {
    S.busy = `Searching Crossref for ${todo.length > 1 ? `${++done} of ${todo.length} DOIs` : 'the right DOI'}`; drawSummary();
    const got = await C.suggestDoi(w.entry, { not: w.csl?.DOI || k }).catch(() => null);
    if (my !== gen) return 0;
    if (got && S.works.get(k) === w) { w.suggest = got; found++; }
  }
  return found;
}
/** The suggested DOI in place of the one typed: its full record, checked against the entry; Undo puts the typed one back. */
async function useDoi(k) {
  const w = S.works.get(k), my = gen; if (!w?.suggest) return;
  const got = await C.fetchWork(w.suggest.doi).catch(() => null) || { csl: w.suggest.csl, source: 'Crossref' };
  if (my !== gen || S.works.get(k) !== w) return;
  const typed = S.scan.dois.find(d => C.doiKey(d) === k) || k;
  S.works.set(k, { ...workOf(w.suggest.doi, got), replaced: typed, prev: w });
  S.dups = C.duplicateWorks(S.scan.dois, cslMap());
  rebuild(); draw();
}
function undoDoi(k) { const w = S.works.get(k); if (w?.prev) { S.works.set(k, w.prev); S.dups = C.duplicateWorks(S.scan.dois, cslMap()); rebuild(); draw(); } }
/** Ids cited for one work, each to the one it is numbered as: a PubMed id and its DOI always, a look-alike pair once chosen. */
function sameMap() {
  const out = new Map();
  for (const g of S.dups || []) if (g.same || S.merged.has(g.keys.join('|'))) for (const k of g.keys) if (k !== g.keep) out.set(k, g.keep);
  return out;
}
const dupOf = k => (S.dups || []).find(g => g.keys.includes(k));
// NLM's directory (assets/journals/nlm-journals.json): the journals' official abbreviations, read once when the first document opens
let nlm = null, nlmLoad = null;
const loadNlm = () => (nlmLoad ||= fetch('./assets/journals/nlm-journals.json').then(r => r.json()).then(j => (nlm = C.nlmIndex(j.entries))).catch(() => null));
// The registries and NLM's directory are asked at once; every answer is settled when both have come, so a journal's abbreviation is there
// from the first drawing, and the line says "Looking up" from the first moment (it read "0 found" while the directory loaded).
async function lookUp() {
  if (!S.scan || S.mode !== 'convert') return;
  const my = gen, nlmReady = S.opts.fill !== 'registry' ? loadNlm() : null, got = new Map();
  for (const d of S.scan.dois) { const k = C.doiKey(d); if (!S.works.has(k)) { const w = fresh(k); if (w) got.set(d, w); } }
  const todo = S.scan.dois.filter(d => !S.works.has(C.doiKey(d)) && !got.has(d));
  let done = 0;
  S.busy = `Looking up ${todo.length ? 0 : S.scan.dois.length} of ${todo.length || S.scan.dois.length}`;
  if (todo.length) { draw(); await C.fetchWorks(todo, { onWork: (d, w) => { if (w) remember(C.doiKey(d), w); if (my !== gen) return; got.set(d, w); done++; S.busy = `Looking up ${done} of ${todo.length}`; drawHead(); drawSummary(); } }); }
  await nlmReady;
  if (my !== gen) return;
  for (const [d, w] of got) settle(d, w);
  S.dups = C.duplicateWorks(S.scan.dois, cslMap());
  rebuild(); draw();
  const found = await suggestAll();
  if (my !== gen) return;
  S.busy = '';
  if (found) { rebuild(); draw(); } else { drawHead(); drawSummary(); }
}
function rebuild() {
  S.version = (S.version || 0) + 1;   // the converted file the paper view shows is written again from this result
  if (!S.scan) return;
  S.result = S.mode === 'cited' ? null : S.mode === 'convert'
    ? C.convertDocument(S.doc, { works: cslMap(), style: styleArg(), marker: marker(), refs: S.opts.refs, heading: S.opts.heading, punctuation: S.opts.punctuation === 'move', same: sameMap() })
    : C.revertDocument(S.doc, { marker: marker() });
}
async function download() {
  if (!S.result) return;
  const blob = await C.writeDocx(S.pkg, S.result.doc, S.mode === 'convert' ? { citations: S.result.citations, style: styleArg() } : { citations: null });
  const name = `${S.name.replace(/\.docx$/i, '')} (${S.mode === 'convert' ? 'Mendeley' : 'DOI'}).docx`;
  save(blob, name);
}
/** The converted file with its citations and list as plain text (no Mendeley controls, no add-in part): what a journal asks for at submission. */
async function downloadPlain() {
  if (!S.result || S.mode !== 'convert') return;
  const name = `${S.name.replace(/\.docx$/i, '')} (plain citations).docx`;
  save(await C.writeDocx(S.pkg, C.plainDocument(S.result.doc).doc, { citations: null }), name);
}
function save(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const ordered = () => (S.mode === 'convert' ? S.scan.dois : [...S.works.keys()]).map(d => S.works.get(C.doiKey(d))).filter(w => w?.csl);
async function exportAs(kind) {
  const works = ordered(), base = S.name.replace(/\.docx$/i, ''), { toRis, toBibtex } = await import('../lib/bib-export.mjs');
  if (kind === 'ris') save(new Blob([toRis(works.map(w => C.recordOf(w.csl)))], { type: 'application/x-research-info-systems' }), `${base}.ris`);
  if (kind === 'bib') save(new Blob([toBibtex(works.map(w => C.recordOf(w.csl)))], { type: 'application/x-bibtex' }), `${base}.bib`);
  if (kind === 'csl') save(new Blob([JSON.stringify(works.map(w => w.csl), null, 2)], { type: 'application/json' }), `${base}.json`);
}
/**
 * Copies, and says so where it was asked: the pressed button's icon is a check for a moment (it keeps its size, so nothing moves), and
 * the words go to a screen reader. A copy that the browser refuses is said in the line, where it stays until the next change.
 */
async function copy(text, done, from) {
  try { await navigator.clipboard.writeText(text); } catch { S.note = 'The browser did not allow copying.'; drawSummary(); return; }
  const live = $('dc-live'); if (live) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = done; }); }
  const ico = from?.querySelector('.ico'); if (!ico) return;
  const was = ico.outerHTML;
  ico.outerHTML = icon('check').replace('class="ico"', 'class="ico dc-done"');
  setTimeout(() => { const now = from.querySelector('.dc-done'); if (now) now.outerHTML = was; }, 1400);
}
/** What a co-author needs to look at, as plain text: the document, the counts, and each work to check with what differs. */
function checkReport() {
  const lines = [`DOI to Mendeley check: ${S.name}`, `${plural(S.scan.markers.length, 'citation', 'citations')} to ${plural(S.scan.dois.length, 'work', 'works')}.`, ''];
  const work = S.scan.dois.map((d, i) => ({ n: i + 1, d, w: S.works.get(C.doiKey(d)) }));
  const items = work.filter(({ w }) => w?.missing || w?.notices?.length || (w?.issues || []).length).map(({ n, d, w }) => {
    const r = w?.csl ? C.recordOf(w.csl) : null, why = [w?.missing ? 'not found in Crossref or doi.org' : '', ...(w?.notices || []).map(x => `${x.label}${x.year ? ` (${x.year})` : ''}`),
      ...(w?.issues || []).map(x => x.text || `${x.field}: ${x.entry || 'none'} in the list, ${x.registry || 'none'} in ${w.source}`), w?.suggest ? `a likely DOI: ${w.suggest.doi}` : ''].filter(Boolean);
    return `${n}. ${r ? `${(r.authors[0] || '').split(',')[0]} ${r.year}, ${r.title}` : `doi:${d}`}\n   ${why.join('; ')}`;
  });
  lines.push(items.length ? 'To check:' : 'Every work matches the typed list.', ...items);
  const { notCited, notListed } = C.listChecks(S.scan, cslMap());
  if (notCited.length) lines.push('', 'In the typed list but not cited:', ...notCited.map(e => `   ${e.text}`));
  if (notListed.length) lines.push('', 'Cited but not in the typed list:', ...notListed.map(d => `   doi:${d}`));
  if (S.scan.unmentioned?.length) lines.push('', `Cited in but never mentioned in the text: ${S.scan.unmentioned.join(', ')}`);
  return lines.join('\n') + '\n';
}
function reset() { clearDoc(); Object.assign(S, { name: '', pkg: null, doc: '', scan: null, error: '', busy: '' }); draw(); }

// ---- drawing --------------------------------------------------------------------------------------------------------------------
function drawHead() {
  if (!S.pkg) { $('dc-head').innerHTML = ''; return; }
  const ready = !!S.result && !S.busy;
  // the primary act follows the file: convert and download; for a file already cited with Mendeley, the way back to DOI markers
  const primary = S.mode === 'cited' ? { id: 'dc-revert', label: 'Turn back into DOI markers', icon: 'undo', role: 'primary' }
    : { id: 'dc-download', label: S.mode === 'revert' ? 'Download file with DOI markers' : 'Download converted file', icon: 'download', role: 'primary', disabled: !ready };
  $('dc-head').innerHTML = uiBar({ kind: 'head', label: 'DOI to Mendeley', stack: false, lead: { title: S.name || 'DOI to Mendeley', level: 'h1', id: 'dc-title' },
    actions: [{ id: 'dc-open', label: S.pkg ? 'Open another' : 'Open document', icon: 'import' },
      { id: 'dc-export', label: 'Export', icon: 'export', menu: true, disabled: !S.works.size }, primary],
    overflow: [{ id: 'dc-reset', label: 'Close document', disabled: !S.pkg }] });
}
const TYPE = { 'journal-article': 'Journal article', 'book-chapter': 'Book chapter', 'proceedings-article': 'Conference paper', 'posted-content': 'Preprint', book: 'Book', dataset: 'Dataset', 'reference-entry': 'Reference entry' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = d => [d[2], MONTHS[d[1] - 1], d[0]].filter(Boolean).join(' ');
// The settings' column shows a work's details while one is open (a citation, its card or a row of the References pressed); Close goes back.
const sideHtml = () => (S.detail ? detailHtml(S.detail) : settings());
// The settings' column: beside the document on a wide window (Settings hides it, for the pages' room), a sheet over the foot of a narrow
// one, closed until Settings or a work's details open it. It stacked under the whole document before, out of reach on a phone.
const stacked = () => $('dc-body')?.dataset.stack === 'true';
const panelShown = () => (stacked() ? S.panel === 'open' : S.panel !== 'closed');
function setPanel(open) {
  S.panel = stacked() ? (open ? 'open' : '') : (open ? '' : 'closed');
  const body = $('dc-body'); if (body) body.dataset.panel = S.panel;
  const b = $('dc-panel'); if (b) b.setAttribute('aria-pressed', String(panelShown()));
  if (!stacked()) fitPaper();
}
function openDetail(keys) {
  S.detail = [...new Set(keys)];
  enrich(S.detail);
  const side = $('dc-side'); if (!side) return;
  side.innerHTML = sideHtml(); side.setAttribute('aria-label', 'Details'); side.scrollTop = 0;
  if (!panelShown()) setPanel(true);
  document.querySelectorAll('.dc-refs tr[data-work]').forEach(tr => tr.toggleAttribute('aria-current', S.detail.includes(tr.dataset.work)));
}
// What the details add, fetched when a work's details first open: Crossref's fuller record (for a work kept from before it was read) and
// PubMed's (PMID, PMCID, type, MeSH, abstract). Kept with the work's cached answer, so it is fetched once.
const pubmed = new Map();
async function enrich(keys) {
  for (const k of keys) {
    const w = S.works.get(k), my = gen; if (!w?.csl || w.source === 'Your list') continue;
    const jobs = [];
    // a cached work's record keeps no abstract (remember): the details ask Crossref once more for it
    if (!w.meta || w.meta.lite) jobs.push(C.fetchWork(w.csl.DOI || k).then(r => { if (r?.meta) { w.meta = r.meta; if (cached[k]) remember(k, { ...cached[k].w, meta: r.meta }); } }).catch(() => {}));
    if (!pubmed.has(k)) { pubmed.set(k, 'loading'); jobs.push(C.pubmedOf(w.csl.DOI || k).then(pm => { if (my === gen) pubmed.set(k, pm); }).catch(() => { if (my === gen) pubmed.set(k, null); })); }
    if (!jobs.length) continue;
    await Promise.all(jobs);
    if (my !== gen) return;
    if (S.detail?.includes(k)) { const side = $('dc-side'), at = side?.scrollTop || 0; if (side) { side.innerHTML = sideHtml(); side.scrollTop = at; } }
  }
}
function closeDetail() {
  S.detail = null;
  const side = $('dc-side'); if (side) { side.innerHTML = sideHtml(); side.setAttribute('aria-label', 'Citation style'); }
  if (stacked() || S.mode === 'cited') setPanel(false);   // the column was opened for the details (a narrow window's sheet, or a cited file's, which has no settings): it closes with them
  document.querySelectorAll('.dc-refs tr[aria-current]').forEach(tr => tr.removeAttribute('aria-current'));
}
/** Everything about the works: the full author list, journal and its abbreviation, where it appeared, the DOI and PubMed as links, the source,
 * how often it is cited, and the check against the typed entry, which is shown too. */
function detailHtml(keys) {
  const one = keys.length === 1, first = S.result?.numbers?.get(keys[0]);
  const head = uiBar({ kind: 'head', label: 'Details', lead: { title: one ? `Reference ${first ?? ''}`.trim() : `${keys.length} works cited together`, level: 'h2', id: 'dc-detail-title' },
    actions: [{ id: 'dc-detail-close', label: 'Close details', icon: 'close', role: 'quiet' }] });
  return head + keys.map((k, i) => {
    const w = S.works.get(k), c = usedCsl(k, w), r = c ? C.recordOf(c) : null, n = S.result?.numbers?.get(k), entry = w?.entry;
    const [tone, ic, words, notice] = stateOf(w, k), cited = S.scan.markers.filter(m => m.dois.some(d => C.doiKey(d) === k)).length;
    const doi = c?.DOI || (C.isPmid(k) ? '' : k), fact = (name, html) => (html ? `<dt>${name}</dt><dd>${html}</dd>` : '');
    const m = w?.meta, pm = pubmed.get(k), pmid = (pm && pm !== 'loading' && pm.pmid) || r?.pmid || '';
    // PubMed's abstract with its parts' labels, else the one the publisher gave Crossref
    const abstract = pm?.abstract?.length ? pm.abstract.map(a => `<p>${a.label ? `<b>${esc(a.label)}</b> ` : ''}${esc(a.text)}</p>`).join('') : m?.abstract ? `<p>${esc(m.abstract)}</p>` : '';
    const where = r ? [r.year, r.volume && `${r.volume}${r.issue ? `(${r.issue})` : ''}`].filter(Boolean).join(';') + (r.pages ? `:${r.pages}` : '') : '';
    // the check's line already names the serious differences (or, with none, the notes): the list under it gives only what the line leaves out
    const serious = (w?.issues || []).some(x => x.severity !== 'note');
    const diffs = (w?.issues || []).filter(x => serious && x.severity === 'note').map(x => `<li>${esc(x.field)}: ${esc(x.entry || 'none')} in your list, ${esc(x.registry || 'none')} in ${esc(w.source)}</li>`).join('');
    // what a reader checks first stays in view; the rest is under More details, open or closed as the last work left it
    const main = fact('Authors', r?.authors.length ? esc(r.authors.map(a => { const [f, g = ''] = a.split(','); return `${f.trim()} ${g.trim().split(/[\s.-]+/).filter(Boolean).map(x => x[0]).join('')}`.trim(); }).join(', ')) : '')
      + fact('Journal', r?.journal ? esc(r.journal) + (r.journalAbbr && r.journalAbbr !== r.journal ? ` <span class="dc-quiet">${esc(r.journalAbbr)}</span>` : '') : '')
      + fact('Published', esc(where))
      + fact('DOI', doi ? `<a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">${esc(doi)}</a>${w?.replaced ? ` <span class="dc-quiet">typed ${esc(w.replaced)}</span>` : ''}` : '')
      + fact('Suggested', w?.suggest && !w.replaced ? `<a href="https://doi.org/${esc(w.suggest.doi)}" target="_blank" rel="noopener">${esc(w.suggest.doi)}</a>` : '')
      + fact('PubMed', pm === 'loading' ? '<span class="dc-quiet">Looking up</span>' : pmid ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${esc(pmid)}/" target="_blank" rel="noopener">${esc(pmid)}</a>` : pm ? '<span class="dc-quiet">Not in PubMed</span>' : '')
      + fact('Check', `<span class="dc-state" data-tone="${tone}">${icon(ic)}<span>${esc(words)}</span></span>${notice ? `<a class="dc-notice" href="https://doi.org/${esc(notice)}" target="_blank" rel="noopener">Notice</a>` : ''}${fixHtml(k, w)}${diffs ? `<ul class="dc-diffs">${diffs}</ul>` : ''}`)
      + fact('Cited here', esc(plural(cited, 'time', 'times')));
    const more = fact('Dates', esc([m?.print && `${dateText(m.print)} in print`, m?.online && `${dateText(m.online)} online`].filter(Boolean).join(', ')))
      + fact('Type', esc([TYPE[m?.type] || '', ...(pm?.types || [])].filter(Boolean).join(', ')))
      + fact('Publisher', esc(m?.publisher || ''))
      + fact('ISSN', esc((m?.issn || []).join(', ')))
      + fact('PMC', pm?.pmcid ? `<a href="https://pmc.ncbi.nlm.nih.gov/articles/${esc(pm.pmcid)}/" target="_blank" rel="noopener">${esc(pm.pmcid)}</a>` : '')
      + fact('Full text', m?.fulltext ? `<a href="${esc(m.fulltext)}" target="_blank" rel="noopener">${esc(m.fulltext.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>${/creativecommons/.test(m.license) ? ' <span class="dc-quiet">open access</span>' : ''}` : '')
      + fact('Cited by', m?.citedBy != null ? `${esc(String(m.citedBy))} <span class="dc-quiet">in Crossref</span>` : '')
      + fact('References', m?.references ? esc(String(m.references)) : '')
      + fact('Source', esc(S.fromList.has(k) ? 'Your list' : w?.source || ''))
      + fact('MeSH', pm?.mesh?.length ? `<span class="dc-quiet">${esc(pm.mesh.join(', '))}</span>` : '')
      + fact('Your list', entry ? `<span class="dc-quiet">${esc(entry.replace(/^\s*\d{1,3}[.)]\s*/, '').replace(/^doi:\S+\s*[—–-]\s*/i, ''))}</span>` : '');
    return `<section class="dc-work">${one ? '' : `<p class="dc-work-n">${n ?? ''}</p>`}<h3 class="dc-work-title">${esc(r?.title || (doi ? `doi:${doi}` : k.toUpperCase()))}</h3><dl class="dc-facts">${main}</dl>`
      + (more ? `<details class="dc-more-facts"${S.moreFacts ? ' open' : ''}><summary>More details</summary><dl class="dc-facts">${more}</dl></details>` : '')
      + `${abstract ? `<details class="dc-abstract"><summary>Abstract</summary>${abstract}</details>` : ''}${uiBar({ kind: 'foot', label: 'Copy', actions: [{ id: `dc-copy-ref-${i}`, label: 'Copy reference', icon: 'copy', attrs: { 'data-copy-ref': k } }, { id: `dc-copy-doi-${i}`, label: 'Copy DOI link', icon: 'link', attrs: { 'data-copy-doi': k } }] })}</section>`;
  }).join('');
}
const select = (key, items) => `<select data-opt="${key}">${items.map(([v, l]) => `<option value="${esc(v)}"${S.opts[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
function settings() {
  const sup = !!C.styleOf(styleArg()).sup, j = S.opts.journal;
  const FORMAT = { numeric: 'Numbered', 'author-date': 'Author and year', note: 'Footnotes', author: 'Author', label: 'Label' };
  // a journal's own style (the catalog's), or one of the general ones
  // the chosen journal as a line of its own (name, abbreviation, format) with Change; else the search, its results under it
  const journal = j && !S.journalEditing
    ? `<div class="dc-field"><span class="dc-field-label">Journal</span><div class="dc-jsel"><div><p class="dc-jsel-name">${esc(j.label)}</p><p class="dc-jsel-meta">${esc([j.abbr !== j.label && j.abbr, `${FORMAT[j.format] || 'Numbered'} style`].filter(Boolean).join(', '))}</p></div>`
      + `<button type="button" class="link" id="dc-journal-change">Change</button></div><p class="dc-field-note">Mendeley Cite applies its exact rules. <button type="button" class="link" id="dc-journal-clear">Use a general style</button></p></div>`
    : `<div class="dc-field"><label class="dc-field-label" for="dc-journal">Journal</label><div class="dc-jcombo">${icon('search')}<input id="dc-journal" data-journal role="combobox" aria-expanded="false" aria-controls="dc-jlist" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search 10,000 journal styles">`
      + `<div class="dc-jlist" id="dc-jlist" role="listbox" aria-label="Journals" hidden></div></div>${j ? '<p class="dc-field-note"><button type="button" class="link" id="dc-journal-keep">Keep ' + esc(j.label) + '</button></p>' : ''}</div>`;
  const style = j ? (j.format === 'numeric' || j.format === 'note' || !j.format ? formField('Numbers', select('numbers', [['sup', 'Superscript'], ['brackets', '[1]'], ['parens', '(1)']])) : '')
    : formField('Style', select('style', Object.entries(C.STYLES).map(([k, x]) => [k, x.label])));
  const marks = `<div class="dc-group">${formField('Brackets', select('brackets', [['round', '(doi:…)'], ['square', '[doi:…]'], ['curly', '{doi:…}'], ['none', 'None']]))}`
    + formField('Prefix', select('prefix', [['any', 'Any (doi:, DOI, doi.org link)'], ['doi', 'doi: only'], ['link', 'doi.org link only'], ['bare', 'None (10.xxxx/…)']]))
    + formField('Between DOIs', select('separator', [['any', 'Semicolon or comma'], ['semicolon', 'Semicolon'], ['comma', 'Comma']])) + '</div>';
  // the marker format is found by default; its settings are for drafts written another way
  const shown = { round: '()', square: '[]', curly: '{}', none: '' }[S.opts.brackets] || '()';
  const more = `<details class="dc-more"${S.moreOpen ? ' open' : ''}><summary>DOI marker format<span>${esc(shown.slice(0, 1))}doi:…${esc(shown.slice(1))}</span></summary>${marks}</details>`;
  if (S.mode === 'revert') return marks;
  return `<div class="dc-group"><h2>Citations</h2>${journal}${style}`
    + (sup ? formField('Punctuation', select('punctuation', [['move', 'Number after full stops and commas'], ['keep', 'Number where the marker was']])) : '')
    + formField('Journal names', select('fill', [['list', 'From my list, else NLM'], ['nlm', 'NLM abbreviations'], ['registry', 'As Crossref has them']])) + '</div>'
    + `<div class="dc-group"><h2>Reference list</h2>${formField('List', select('refs', [['auto', S.scan?.refList ? 'Replace my typed list' : 'Add at the end'], ['end', 'Add at the end'], ['none', 'None (insert in Word)']]))}`
    + (S.opts.refs === 'none' ? '' : formField('Heading', `<input data-opt="heading" value="${esc(S.opts.heading)}">`)) + '</div>' + more;
}
const segHtml = (s, side) => {
  let t = esc(s.t);
  if (s.b) t = `<b>${t}</b>`; if (s.i) t = `<i>${t}</i>`; if (s.sup) t = `<sup>${t}</sup>`; if (s.sub) t = `<sub>${t}</sub>`;
  return s.cite ? `<span class="dc-cite" data-side="${side}" data-dois="${esc(s.cite.dois.join(' '))}" tabindex="0">${t}</span>` : t;
};
const paraHtml = (p, side) => `<p class="${p.heading ? 'dc-h' : ''}${p.bib ? ' dc-bibp' : ''}">${p.segs.map(s => segHtml(s, side)).join('') || '&nbsp;'}</p>`;
function changes() {
  const before = C.previewOf(S.doc, { marker: marker() }), after = C.previewOf(S.result.doc, { marker: marker() });
  const cited = new Set((S.mode === 'convert' ? S.scan.markers : S.scan.mendeley).map(m => m.para));
  const rows = [...cited].sort((a, b) => a - b).map(i => `<div class="dc-pair">${paraHtml(before[i], 'old')}${paraHtml(after[i] || { segs: [] }, 'new')}</div>`).join('');
  const skipped = S.mode === 'convert' && S.result.skipped ? `<p class="note">${plural(S.result.skipped, 'marker crosses', 'markers cross')} a link or tracked change and stays as typed.</p>` : '';
  return `${skipped}<div class="dc-pairs"><div class="dc-pair dc-legend"><span>Original</span><span>${S.mode === 'convert' ? 'Converted' : 'DOI markers'}</span></div>${rows}</div>`;
}
// Original and Converted are the file as Word lays it out: white pages at the document's own size, type and spacing (lib/docx-pages.mjs,
// the Files viewer's renderer), painted scaled to the column. The converted file's citations open their card as in Changes.
// A strip of the pages at the left (Word's and Preview's thumbnails): where you are, and a press goes to a page. It leaves a narrow column.
const document_ = () => `<div class="dc-paper" id="dc-paper" aria-busy="true"><nav class="dc-thumbs" id="dc-thumbs" aria-label="Pages"></nav><div class="dc-desk" id="dc-desk"><div class="dc-paper-stage"><div class="fv-doc-layout ms-pages" id="dc-layout" role="document"></div></div></div><p class="dc-paper-wait"><span class="ui-progress-ring" aria-hidden="true"></span> Laying out the pages</p></div>`;
let paperBytes = { version: -1, bytes: null };
// The laid-out pages of both views, kept while they are not shown: switching between Original and Converted puts them back instead of
// laying them out again. The converted pages remember the text they were laid out from and are reused only for that text.
const papers = { old: null, new: null };
/** Lets a page view go: its pictures' object URLs are revoked (they otherwise live until the tab closes). */
function dropPaper(box) { for (const u of box?.__urls || []) URL.revokeObjectURL(u); if (box) box.__urls = []; }
async function mountPaper(which) {
  const box = $('dc-paper'), layout = $('dc-layout'), my = gen; if (!box || !layout) return;
  box.dataset.which = which;
  box.__pkg = S.pkg;   // whose pages these are: another file's are never put back
  box.__doc = which === 'new' ? S.result.doc : null;
  let bytes = S.bytes;
  if (which === 'new') {
    if (paperBytes.version !== S.version) paperBytes = { version: S.version, bytes: new Uint8Array(await (await C.writeDocx(S.pkg, S.result.doc, S.mode === 'convert' ? { citations: S.result.citations, style: styleArg() } : { citations: null })).arrayBuffer()) };
    bytes = paperBytes.bytes;
  }
  const { renderDocxPages } = await import('../lib/docx-pages.mjs');
  if (!layout.isConnected || my !== gen) return;
  const r = await renderDocxPages(layout, bytes);
  box.__urls = r.urls || [];
  if (my !== gen || !box.isConnected) { dropPaper(box); return; }
  box.removeAttribute('aria-busy');
  layout.dataset.width = r.width;
  if (which === 'new' && S.mode === 'convert') {
    const marks = layout.querySelectorAll('sup.tok.cite');
    // the renderer draws every citation as a superscript number; each shows here as the converted file shows it ("(7)", "[7]", "7")
    const sup = !!C.styleOf(styleArg()).sup;
    if (marks.length === S.result.citations.length) marks.forEach((m, i) => {
      const c = S.result.citations[i], el = sup ? m : document.createElement('span');
      if (!sup) { el.className = 'tok dc-inline-cite'; m.replaceWith(el); }
      el.textContent = c.manualOverride.citeprocText.replace(/<[^>]+>/g, '');
      el.classList.add('dc-cite'); el.dataset.side = 'new'; el.tabIndex = 0; el.dataset.dois = c.keys.join(' ');
    });
  }
  // the reference list's entries answer as the citations do: a card on hover, the details on a press (matched to the list by their text)
  if (which === 'new' && S.mode === 'convert' && S.result.bibKeys) {
    const lead = t => t.replace(/\s+/g, ' ').replace(/^\s*\d{1,3}\.\s*/, '').trim().slice(0, 48);
    const lines = S.result.bibliography.map(lead);
    layout.querySelectorAll('.para').forEach(para => {
      const at = lines.indexOf(lead(para.textContent)); if (at < 0 || !lead(para.textContent)) return;
      para.classList.add('dc-cite', 'dc-bib-entry'); para.dataset.dois = S.result.bibKeys[at]; para.tabIndex = 0;
    });
  }
  fitSteps(box, 'thumbs', [[720, 'on']], 'off');   // the strip only where the pages keep their room beside it (lib/split-fit.mjs)
  fitPaper();
  drawThumbs();
  watchWidth(box, fitPaper);   // the width engine hears the column change (lib/ui-actions.mjs), as lib/split-fit.mjs does
}
const THUMB_W = 96;
/** Each page as a miniature: a copy of its laid-out page, scaled, inert (no focus, no ids, no cards). */
function drawThumbs() {
  const nav = $('dc-thumbs'), pages = [...($('dc-layout')?.querySelectorAll(':scope > .pg') || [])]; if (!nav || !pages.length) return;
  nav.innerHTML = pages.map((pg, i) => `<button type="button" class="dc-thumb" data-page="${i}" aria-label="Page ${i + 1}"${i ? '' : ' aria-current="page"'}><span class="dc-thumb-sheet"></span><span class="dc-thumb-n">${i + 1}</span></button>`).join('');
  const sizes = pages.map(pg => [pg.offsetWidth, pg.offsetHeight]);   // read every page's size first: one layout, not one per page
  nav.querySelectorAll('.dc-thumb-sheet').forEach((sheet, i) => {
    const pg = pages[i], k = THUMB_W / sizes[i][0], copy = pg.cloneNode(true);
    copy.querySelectorAll('[id],[tabindex],[data-dois]').forEach(e => { e.removeAttribute('id'); e.removeAttribute('tabindex'); e.removeAttribute('data-dois'); e.classList.remove('dc-cite', 'dc-bib-entry'); });
    copy.setAttribute('aria-hidden', 'true'); copy.inert = true; copy.style.transform = `scale(${k})`;
    sheet.style.setProperty('--dc-sheet-h', `${Math.round(sizes[i][1] * k)}px`);
    sheet.append(copy);
  });
}
/** The page whose top has passed a third of the column is the current one; its thumbnail is marked and kept in view. */
let thumbFrame = 0;
function markThumb() {
  thumbFrame = 0;
  const main = document.querySelector('.dc-main'), nav = $('dc-thumbs'); if (!main || !nav || nav.hidden) return;
  const line = main.getBoundingClientRect().top + main.clientHeight / 3, pages = [...($('dc-layout')?.querySelectorAll(':scope > .pg') || [])];
  let at = 0; pages.forEach((pg, i) => { if (pg.getBoundingClientRect().top <= line) at = i; });
  const now = nav.querySelector('[aria-current]'); if (now?.dataset.page === String(at)) return;
  now?.removeAttribute('aria-current');
  const t = nav.querySelector(`[data-page="${at}"]`); if (!t) return;
  t.setAttribute('aria-current', 'page');
  // the strip alone scrolls to it: scrollIntoView would move every scroller around it too, and pulled the pages back while they were scrolled
  const n = nav.getBoundingClientRect(), r = t.getBoundingClientRect();
  if (r.top < n.top) nav.scrollTop += r.top - n.top; else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom;
}
document.addEventListener('scroll', e => { if (e.target.classList?.contains('dc-main') && $('dc-thumbs') && !thumbFrame) thumbFrame = requestAnimationFrame(markThumb); }, { capture: true, passive: true });
function goToPage(i) {
  const main = document.querySelector('.dc-main'), pg = $('dc-layout')?.querySelectorAll(':scope > .pg')[i], bar = main?.querySelector('.dc-views'); if (!main || !pg) return;
  main.scrollTo({ top: main.scrollTop + pg.getBoundingClientRect().top - main.getBoundingClientRect().top - (bar?.offsetHeight || 0) - 8 });
}
/** The pages painted at the column's width, never past their own size: scaled, not re-flowed, as the Files viewer does. */
function fitPaper() {
  const box = $('dc-paper'), desk = $('dc-desk'), layout = $('dc-layout'), width = Number(layout?.dataset.width); if (!width || !desk) return;
  const zoom = Math.min(1, Math.max(0.3, (desk.clientWidth - 2) / width));
  // at full size no transform: one scaled layer as tall as the whole document is what tore when scrolled fast in WebKit
  layout.style.setProperty('--fv-layout-w', `${width}px`); layout.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
  box.style.setProperty('--dc-stage-w', `${width * zoom}px`); box.style.setProperty('--dc-stage-h', `${layout.offsetHeight * zoom}px`);
  if (S.paperScroll) { const main = box.closest('.dc-main'); if (main) main.scrollTop = S.paperScroll; S.paperScroll = 0; }
}
function stateOf(w, k) {
  if (!w || (!w.csl && !w.missing)) return ['quiet', 'dot', 'Looking up'];
  if (w.missing) return ['bad', 'close', 'Not found'];
  const g = k && dupOf(k), other = g && g.keys.find(x => x !== k), on = g && (g.same || S.merged.has(g.keys.join('|')));
  if (g && !on) return ['warn', 'warn', `Same work as ${S.result?.numbers?.get(other) ?? other}`];
  const n = (w.notices || [])[0];
  if (n) return [C.isRetracted(w.notices) ? 'bad' : 'warn', 'warn', `${{ retraction: 'Retracted', withdrawal: 'Withdrawn', removal: 'Removed', partial_retraction: 'Partly retracted', expression_of_concern: 'Expression of concern', correction: 'Corrected', erratum: 'Corrected', corrigendum: 'Corrected' }[n.type] || n.label}${n.year ? ` in ${n.year}` : ''}`, n.doi];
  const serious = (w.issues || []).filter(i => i.severity !== 'note');
  if (serious.length) return ['warn', 'warn', serious.map(i => i.text || `${i.field}: ${i.entry || '—'} in list, ${i.registry || '—'} in ${w.source}`).join('; ')];
  if (w.unknown && w.suggest) return ['warn', 'warn', 'Typed DOI not found'];
  if (w.replaced) return ['good', 'check', 'DOI corrected'];
  if (on) return ['good', 'check', g.same ? 'PMID and DOI, numbered once' : 'Same work, numbered once'];
  const notes = w.issues || [];
  return ['good', 'check', notes.length ? notes.map(i => `${i.field}: ${i.entry || '—'} in list, ${i.registry || 'none'} in ${w.source}`).join('; ') : !S.scan.refList ? 'Found' : w.entry ? 'Matches list' : 'Found, not in your list'];
}
/** What the person can do about a work's check: use the DOI Crossref suggests (or undo it), cite two ids of one work as one (or undo it). */
function fixHtml(k, w) {
  const g = dupOf(k), id = g?.keys.join('|');
  if (w?.suggest && !w.replaced) return `<button type="button" class="link dc-fix" data-use-doi="${esc(k)}" title="${esc(`${w.suggest.doi}: ${C.recordOf(w.suggest.csl).title}`)}">Use suggested DOI</button>`;
  if (w?.replaced) return `<button type="button" class="link dc-fix" data-undo-doi="${esc(k)}" title="${esc(`Back to ${w.replaced}`)}">Undo</button>`;
  if (g && !g.same) return S.merged.has(id) ? `<button type="button" class="link dc-fix" data-unmerge="${esc(id)}">Undo</button>` : `<button type="button" class="link dc-fix" data-merge="${esc(id)}">Cite as one</button>`;
  return '';
}
function references() {
  const list = S.mode === 'convert' ? S.scan.dois : [...S.works.keys()];
  const rows = list.map((d, i) => {
    const w = S.works.get(C.doiKey(d)), [tone, ic, words, notice] = stateOf(w, C.doiKey(d)), used = usedCsl(C.doiKey(d), w), no = S.result?.numbers?.get(C.doiKey(d)) ?? i + 1;
    const line = used ? C.referenceText(styleArg(), no, C.recordOf(used)).replace(/^\d+\.\s*/, '') : C.isPmid(d) ? `PMID ${esc(d.slice(5))}` : `doi:${esc(d)}`;
    // a work first cited in a table or legend is numbered where the text first mentions it (lib/doi-cite.mjs, scanDocument)
    const where = S.scan.firstIn?.get(C.doiKey(d)), unsaid = where && S.scan.unmentioned?.includes(where);
    const extra = [where ? `First cited in ${where}${unsaid ? ', which the text never mentions' : ''}` : '', w?.fixed?.length ? `Repaired ${w.fixed.join(', ')}` : '', w?.filled?.some(f => f !== 'journal') ? `From list: ${w.filled.filter(f => f !== 'journal').join(', ')}` : ''].filter(Boolean).join('; ');
    // a work the registry and the typed list both describe takes its data from either: the registry by default, the list where the registry is wrong
    // the picker only where the two differ (or the list was chosen); where they agree it would only repeat a field
    const k = C.doiKey(d), source = w?.listCsl && w.source !== 'Your list' && ((w.issues || []).length || w.notices?.length || S.fromList.has(k))
      ? `<select class="ui-cell-field" data-src="${esc(k)}" aria-label="Source for ${i + 1}"><option value="registry">${esc(w.source)}</option><option value="list"${S.fromList.has(k) ? ' selected' : ''}>Your list</option></select>` : esc(w?.source || '');
    const state = `<span class="dc-state" data-tone="${tone}">${icon(ic)}<span>${esc(words)}</span></span>`, fix = fixHtml(k, w);
    return `<tr data-work="${esc(k)}" tabindex="0"${S.detail?.includes(k) ? ' aria-current="true"' : ''}><td class="num">${no}</td><td>${esc(line)}${extra ? `<div class="meta">${esc(extra)}</div>` : ''}<div class="dc-fold">${source}${state}${fix}</div></td><td>${source}</td><td><span class="dc-state" data-tone="${tone}">${icon(ic)}<span>${esc(words)}</span></span>${notice ? `<a class="dc-notice" href="https://doi.org/${esc(notice)}" target="_blank" rel="noopener">Notice</a>` : ''}${fix}</td></tr>`;
  }).join('');
  const { notCited, notListed } = S.mode === 'convert' ? C.listChecks(S.scan, cslMap()) : { notCited: [], notListed: [] };
  const extraRows = notCited.map(e => `<tr class="dc-uncited"><td class="num"></td><td>${esc(e.text.replace(/^\s*\d{1,3}[.)]\s*/, '').replace(/^doi:\S+\s*[—–-]\s*/i, ''))}<div class="dc-fold">Your list<span class="dc-state" data-tone="warn">${icon('warn')}<span>In your list, not cited</span></span></div></td><td>Your list</td><td><span class="dc-state" data-tone="warn">${icon('warn')}<span>In your list, not cited</span></span></td></tr>`).join('');
  const missingNote = notListed.length ? `<p class="dc-line">${icon('warn')}Cited but not in your typed list: ${esc(notListed.map(d => (C.isPmid(d) ? `PMID ${d.slice(5)}` : `doi:${d}`)).join(', '))}</p>` : '';
  return missingNote + `<div class="dc-refs-wrap" id="dc-refs-wrap">` + tableRegion({ label: 'References', html: `<table class="dc-refs"><thead><tr><th scope="col">No.</th><th scope="col">Reference</th><th scope="col">Source</th><th scope="col">Check</th></tr></thead><tbody>${rows}${extraRows}</tbody></table>` }) + '</div>';
}
function drawBody() {
  const body = $('dc-body');
  body.toggleAttribute('data-empty', !S.pkg);
  if (S.pkg && S.mode === 'cited' && !S.detail) S.panel = stacked() ? '' : 'closed';   // a file opened as it is has nothing to set: the column is for a work's details
  body.dataset.panel = S.panel || '';
  if (!S.pkg) { home(body); return; }
  const none = S.mode === 'convert' && !S.scan.markers.length;
  const checks = toCheck(), views = S.mode === 'convert' ? [['changes', 'Changes'], ['after', 'Converted'], ['before', 'Original'], ['refs', 'References', checks.n || '', checks.mark]] : S.mode === 'cited' ? [['before', 'Document'], ['refs', 'Works']]
    : [['changes', 'Changes'], ['after', 'With DOI markers'], ['before', 'Original'], ['refs', 'Works']];
  if (!views.some(v => v[0] === S.view)) S.view = views[0][0];
  const main = none ? ''
    : S.view === 'changes' ? changes() : S.view === 'refs' ? references() : document_();
  // a redraw (a setting, a lookup) keeps where each column was scrolled; a new view opens at its top
  const kept = S.view === S.drawnView ? [...body.querySelectorAll(':scope > .dc-main, :scope > .dc-side')].map(e => e.scrollTop) : [0, body.querySelector(':scope > .dc-side')?.scrollTop || 0];
  S.drawnView = S.view;
  // the pages on screen are set aside before the redraw; the view's own are put back when they would come out the same (the original
  // always, the converted file while its text is unchanged). Laying them out again on every redraw or switch was slow.
  const want = S.view === 'before' ? 'old' : S.view === 'after' ? 'new' : '', had = $('dc-paper');
  if (had && !had.hasAttribute('aria-busy') && had.dataset.which && had.__pkg === S.pkg) {
    const was = papers[had.dataset.which]; if (was && was !== had) dropPaper(was);
    papers[had.dataset.which] = had; had.remove();
  } else if (had) dropPaper(had);
  const stored = want && papers[want], reuse = stored && stored.__pkg === S.pkg && (want === 'old' || stored.__doc === S.result.doc) ? stored : null;
  if (stored && !reuse) { dropPaper(stored); papers[want] = null; }   // the converted file changed: its old pages are laid out again
  body.innerHTML = `<div class="dc-main"><p class="dc-line" id="dc-summary" aria-live="polite">${summary()}</p>${uiBar({ kind: 'head', stack: false, label: 'Show', cls: 'dc-views', message: { id: 'dc-progress', text: progress() }, view: { id: 'dc-view', label: 'Show', attr: 'data-dc-view', kind: 'segmented', value: S.view, items: views },
    actions: S.mode === 'cited' ? [] : [{ id: 'dc-panel', label: 'Citation style', icon: 'settings', role: 'quiet', pressed: panelShown() }] })}${main}</div>`
    + `<aside class="dc-side" id="dc-side" aria-label="${S.detail ? 'Details' : 'Citation style'}">${sideHtml()}</aside>`;
  body.querySelectorAll(':scope > .dc-main, :scope > .dc-side').forEach((e, i) => { if (kept[i]) e.scrollTop = kept[i]; });
  S.paperScroll = kept[0];   // the pages are laid out after this: fitPaper puts the column back once they have their height
  const refs = $('dc-refs-wrap'); if (refs) fitSteps(refs, 'cols', [[640, 'all']], 'folded');
  const pairs = body.querySelector('.dc-pairs');
  if (pairs) fitSplit(pairs, 560);
  // put back, the pages keep the width listeners mountPaper gave them (the width engine lets a box go when it leaves the page and takes
  // it again when it returns); one width event fits them to the column now. Adding the listeners again stacked one more on every switch.
  if (reuse) { $('dc-paper').replaceWith(reuse); reuse.dispatchEvent(new CustomEvent('ui-width')); }
  else if (want) mountPaper(want).catch(() => { const box = $('dc-paper'); if (box) box.innerHTML = '<p class="note">These pages could not be laid out here.</p>'; });
}
function draw() { drawHead(); drawBody(); }
/** The settings' column alone, where only it changes (the journal field's Change and Keep). */
function drawSide() { const side = $('dc-side'); if (side) { const at = side.scrollTop; side.innerHTML = sideHtml(); side.scrollTop = at; } }
function drawSummary() {
  const el = $('dc-summary'); if (el) el.innerHTML = summary();
  const msg = $('dc-progress'); if (msg) { msg.textContent = msg.title = progress(); }
}

// The first screen is in cite.html itself (Klaviyo's and Tally's upload pages: one line, one drop target, a real citation before and
// after), so it paints before any script runs; reading a file and a file that is not a document change it in place.
const HOME = $('dc-body').innerHTML;
function home(body) {
  body.innerHTML = HOME;
  if (S.busy === 'Reading') {
    body.querySelector('.dc-drop-mark').innerHTML = '<span class="ui-progress-ring" aria-hidden="true"></span>';
    body.querySelector('.dc-drop-title').textContent = 'Reading the document';
    body.querySelector('#dc-open-empty').disabled = true;
  }
  if (S.error) body.querySelector('#dc-drop').insertAdjacentHTML('beforeend', `<p class="dc-drop-error" role="alert">${icon('warn')}<span>${esc(S.error)}</span></p>`);
}
// Under the file's name only what stops the conversion; work in progress and what an action reported are the view row's message, in the
// slack between the switch and Citation style, so their coming and going moves nothing (lib/ui-actions.mjs, message).
function summary() {
  return S.scan && S.mode === 'convert' && !S.scan.markers.length ? `${icon('warn')} No DOI markers found. Check Brackets and Prefix under DOI markers.` : '';
}
function progress() {
  if (S.busy && S.busy !== 'Reading') return S.busy.replace(/^Looking up (\d+) of (\d+)$/, 'Looking up $1 of $2 works in Crossref');
  return S.note || '';
}
// Works with a retraction, a notice, no record, or a record that differs from the typed list: their count on the References, after a
// warning glyph (red when one is retracted or not found), so it reads as works to check and not as a number of references
function toCheck() {
  const states = [...new Set((S.scan?.dois || []).map(C.doiKey))].map(k => stateOf(S.works.get(k), k)[0]);
  const bad = states.filter(t => t === 'bad').length, n = bad + states.filter(t => t === 'warn').length;
  return { n, mark: n ? { icon: 'warn', tone: bad ? 'bad' : 'warn', title: `${n} to check` } : null };
}

// ---- events ---------------------------------------------------------------------------------------------------------------------
const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', hidden: true });
document.body.append(picker);
picker.addEventListener('change', () => { if (picker.files[0]) open(picker.files[0]); picker.value = ''; });
document.addEventListener('click', e => {
  const cite = e.target.closest?.('.dc-cite[data-dois]');
  if (cite && !cite.closest('.dc-example')) { hideCard(); openDetail(cite.dataset.dois.split(' ').filter(Boolean).map(C.doiKey)); return; }
  const row = e.target.closest?.('.dc-refs tr[data-work]');
  if (row && !e.target.closest('select, a, button')) { openDetail([row.dataset.work]); return; }
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const id = b.id;
  if (b.dataset.useDoi) useDoi(b.dataset.useDoi);
  else if (b.dataset.undoDoi) undoDoi(b.dataset.undoDoi);
  else if (b.dataset.merge) { S.merged.add(b.dataset.merge); rebuild(); draw(); }
  else if (b.dataset.unmerge) { S.merged.delete(b.dataset.unmerge); rebuild(); draw(); }
  else if (id === 'dc-open' || id === 'dc-open-empty' || b.closest('#dc-drop')) picker.click();
  else if (id === 'dc-download') download();
  else if (id === 'dc-revert') { S.mode = 'revert'; S.view = 'changes'; rebuild(); draw(); }
  else if (id === 'dc-export') showMenu(b, [{ label: 'Word with plain citations', run: () => downloadPlain() }, '-', { label: 'RIS (Mendeley, EndNote)', run: () => exportAs('ris') }, { label: 'BibTeX', run: () => exportAs('bib') }, { label: 'CSL JSON', run: () => exportAs('csl') }, '-',
    { label: 'Copy reference list', run: () => copy(S.result?.bibliography?.join('\n') || '', 'Reference list copied.', b) }, { label: 'Copy check report', run: () => copy(checkReport(), 'Check report copied.', b) }]);
  else if (id === 'dc-reset') reset();
  else if (b.classList.contains('dc-thumb')) goToPage(Number(b.dataset.page));
  else if (id === 'dc-detail-close') closeDetail();
  else if (id === 'dc-panel') setPanel(!panelShown());
  else if (b.dataset.copyRef) { const k = b.dataset.copyRef, c = usedCsl(k, S.works.get(k)); if (c) copy(C.referenceText(styleArg(), S.result?.numbers?.get(k) || 1, C.recordOf(c)), 'Reference copied.', b); }
  else if (b.dataset.copyDoi) copy(`https://doi.org/${usedCsl(b.dataset.copyDoi, S.works.get(b.dataset.copyDoi))?.DOI || b.dataset.copyDoi}`, 'DOI link copied.', b);
  else if (id === 'dc-journal-clear') chooseJournal(null);
  else if (id === 'dc-journal-change') { S.journalEditing = true; drawSide(); $('dc-journal')?.focus(); }
  else if (id === 'dc-journal-keep') { S.journalEditing = false; drawSide(); }
  else if (b.dataset.dcView) { if (S.view !== b.dataset.dcView) { S.view = b.dataset.dcView; drawBody(); } }
});
// The journal search: the style catalog joined with NLM's directory (lib/journal-directory.mjs), loaded the first time the field is used.
// Results come under the field: each journal's name, its NLM abbreviation and its format; before anything is typed, the journals the
// document cites that have a style. Arrow keys move, Enter chooses, Escape closes.
let journals = null, journalsLoad = null, jChoices = [], jActive = -1;
const loadJournals = () => (journalsLoad ||= Promise.all([import('../lib/journal-directory.mjs'), fetch('./assets/journals/zotero-catalog.json').then(r => r.json()), fetch('./assets/journals/nlm-journals.json').then(r => r.json())])
  .then(([d, cat, nlm]) => { journals = { d, list: d.byName(d.mergeDirectory(cat.entries, nlm.entries)).filter(e => e.format) }; return journals; }));
const JFORMAT = { numeric: 'Numbered', 'author-date': 'Author and year', note: 'Footnotes' };
/** The journals the document cites most that the catalog has a style for (its own name or its abbreviation, exactly). */
function citedJournals({ d, list }) {
  const counts = new Map();
  for (const w of S.works.values()) { const t = w.csl?.['container-title']; if (t) counts.set(t, (counts.get(t) || 0) + 1); }
  const out = [];
  for (const [t] of [...counts].sort((a, b) => b[1] - a[1])) {
    const hit = d.rankJournals(list, t)[0];
    if (hit && !out.includes(hit) && [hit.label, ...(hit.aliases || [])].some(x => x.toLowerCase().replace(/[^a-z]/g, '') === t.toLowerCase().replace(/[^a-z]/g, ''))) out.push(hit);
    if (out.length === 6) break;
  }
  return out;
}
async function showJournals(input) {
  const q = input.value, dir = await loadJournals();
  if (input.value !== q || !input.isConnected) return;
  const typed = q.trim().length >= 2;
  jChoices = typed ? dir.d.rankJournals(dir.list, q).slice(0, 8) : citedJournals(dir);
  jActive = jChoices.length ? 0 : -1;
  const box = $('dc-jlist');
  box.innerHTML = (!typed && jChoices.length ? '<p class="dc-jgroup">Journals you cite</p>' : '')
    + (typed && !jChoices.length ? '<p class="dc-jempty">No journal style matches</p>' : '')
    + jChoices.map((j, i) => `<div class="dc-jopt" role="option" id="dc-jopt-${i}" data-j="${i}" aria-selected="${i === jActive}"><span class="dc-jopt-name">${esc(j.label)}</span>`
      + `<span class="dc-jopt-meta">${esc([j.abbr !== j.label && j.abbr, JFORMAT[j.format] || j.format].filter(Boolean).join(', '))}</span></div>`).join('');
  box.hidden = !box.innerHTML; input.setAttribute('aria-expanded', String(!box.hidden));
  if (jActive >= 0) input.setAttribute('aria-activedescendant', `dc-jopt-${jActive}`);
}
function moveJournal(step) {
  if (!jChoices.length) return;
  jActive = (jActive + step + jChoices.length) % jChoices.length;
  document.querySelectorAll('.dc-jopt').forEach((o, i) => o.setAttribute('aria-selected', String(i === jActive)));
  $('dc-jopt-' + jActive)?.scrollIntoView({ block: 'nearest' });
  $('dc-journal')?.setAttribute('aria-activedescendant', `dc-jopt-${jActive}`);
}
function chooseJournal(j) {
  S.opts.journal = j ? { id: j.id, label: j.label, format: j.format, abbr: j.abbr || '' } : null; S.journalEditing = false;
  try { localStorage.setItem(KEEP, JSON.stringify(S.opts)); } catch {}
  rebuild(); draw();
}
document.addEventListener('focusin', e => { if (e.target.id === 'dc-journal') showJournals(e.target); });
document.addEventListener('input', e => { if (e.target.id === 'dc-journal') showJournals(e.target); });
document.addEventListener('keydown', e => {
  if (e.target.id !== 'dc-journal') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveJournal(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Enter' && jActive >= 0) { e.preventDefault(); chooseJournal(jChoices[jActive]); }
  else if (e.key === 'Escape') { $('dc-jlist').hidden = true; e.target.setAttribute('aria-expanded', 'false'); }
});
// a press on a result chooses it before the field's blur closes the list
document.addEventListener('mousedown', e => { const o = e.target.closest?.('.dc-jopt'); if (o) { e.preventDefault(); chooseJournal(jChoices[Number(o.dataset.j)]); } });
document.addEventListener('focusout', e => { if (e.target.id === 'dc-journal') setTimeout(() => { const box = $('dc-jlist'); if (box && document.activeElement?.id !== 'dc-journal') { box.hidden = true; e.target.setAttribute('aria-expanded', 'false'); } }, 0); });
document.addEventListener('change', e => {
  const k = e.target.dataset?.src; if (!k) return;
  if (e.target.value === 'list') S.fromList.add(k); else S.fromList.delete(k);
  S.note = ''; rebuild(); draw();
});
document.addEventListener('toggle', e => { if (e.target.classList?.contains('dc-more')) S.moreOpen = e.target.open; if (e.target.classList?.contains('dc-more-facts')) S.moreFacts = e.target.open; }, true);
document.addEventListener('change', async e => {
  const k = e.target.dataset?.opt; if (!k) return;
  S.opts[k] = e.target.value; S.note = '';
  try { localStorage.setItem(KEEP, JSON.stringify(S.opts)); } catch {}
  if (k === 'fill') {
    await loadNlm();
    for (const [key, w] of S.works) if (w.raw) S.works.set(key, Object.assign(workOf(key, { csl: w.raw, source: w.source, notices: w.notices, meta: w.meta }), { suggest: w.suggest, replaced: w.replaced, prev: w.prev?.raw ? Object.assign(workOf(key, { csl: w.prev.raw, source: w.prev.source, notices: w.prev.notices, meta: w.prev.meta }), { suggest: w.prev.suggest }) : w.prev }));
  }
  if (['brackets', 'prefix', 'separator'].includes(k)) { rescan(); lookUp(); } else rebuild();
  draw();
});
// the heading is taken when the field is left or Enter is pressed (the change handler above): a whole conversion per keystroke was waste
// A citation's card: the works it cites, as the reference list will give them, and how each compared with the typed list. It opens
// beside the citation on hover or keyboard focus and never takes the pointer.
const card = Object.assign(document.createElement('div'), { className: 'dc-card', hidden: true, id: 'dc-card' });
card.setAttribute('role', 'tooltip');
document.body.append(card);
function cardFor(el) {
  if (!C || !S.scan) return '';
  const keys = [...new Set(el.dataset.dois.split(' ').filter(Boolean).map(C.doiKey))];
  return keys.map(k => {
    const w = S.works.get(k), used = usedCsl(k, w), r = used ? C.recordOf(used) : null, n = S.result?.numbers?.get(k);
    const [tone, ic, words] = stateOf(w, k);
    // a glance, not the details: the title in two lines, who and where in one, and the check only when it is not a match (the details have the rest)
    const who = r?.authors.length ? r.authors[0].split(',')[0] + (r.authors.length > 1 ? ' et al.' : '') : '';
    const meta = [who, [r?.journalAbbr || r?.journal, r?.year].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return `<div class="dc-card-work">${n ? `<span class="dc-card-n">${n}</span>` : '<span></span>'}<div>`
      + `<p class="dc-card-title">${esc(r?.title || `doi:${k}`)}</p>${meta ? `<p class="dc-card-meta">${esc(meta)}</p>` : ''}`
      + (tone === 'good' ? '' : `<p class="dc-state" data-tone="${tone}">${icon(ic)}<span>${esc(words)}</span></p>`) + '</div></div>';
  }).join('');
}
function showCard(el) {
  const html = cardFor(el); if (!html) return;
  card.innerHTML = html; card.hidden = false; el.setAttribute('aria-describedby', 'dc-card');
  // under the citation, or over it when the window has no room below; never past the window's edges
  const r = el.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, gap = 8;
  const top = r.bottom + gap + h <= innerHeight - gap ? r.bottom + gap : Math.max(gap, r.top - gap - h);
  card.style.left = `${Math.round(Math.min(Math.max(gap, r.left - 16), innerWidth - w - gap))}px`;
  card.style.top = `${Math.round(top)}px`;
}
const hideCard = () => { if (card.hidden) return; card.hidden = true; document.querySelector('[aria-describedby="dc-card"]')?.removeAttribute('aria-describedby'); };
document.addEventListener('mouseover', e => { const el = e.target.closest?.('.dc-cite[data-dois]'); if (el && !el.closest('.dc-example')) showCard(el); });
document.addEventListener('mouseout', e => { if (e.target.closest?.('.dc-cite[data-dois]') && !e.relatedTarget?.closest?.('.dc-cite[data-dois]')) hideCard(); });
document.addEventListener('focusin', e => { const el = e.target.closest?.('.dc-cite[data-dois]'); if (el) showCard(el); else hideCard(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { hideCard(); if (S.detail && !e.target.closest?.('input, select, textarea')) closeDetail(); else if (stacked() && panelShown()) setPanel(false); }
  // a cited work or a row opens its details with Enter, as a press does
  if (e.key === 'Enter' && e.target.matches?.('.dc-cite[data-dois]:not(.dc-example *), .dc-refs tr[data-work]')) { e.preventDefault(); e.target.click(); }
});
addEventListener('scroll', hideCard, { capture: true, passive: true });
document.addEventListener('dragover', e => { e.preventDefault(); document.body.toggleAttribute('data-drop', true); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.removeAttribute('data-drop'); });
document.addEventListener('click', e => { if (e.target.closest?.('#dc-drop') && !e.target.closest('button')) picker.click(); });
document.addEventListener('drop', e => { e.preventDefault(); document.body.removeAttribute('data-drop'); const f = e.dataTransfer?.files?.[0]; if (f) open(f); });
fitSplit($('dc-body'), 960);   // below 960px the document takes the width and the settings are a sheet
fitSteps(document.querySelector('.dc-brand'), 'crumb', [[640, 'full']], 'short');   // below 640px an open file's name keeps the room

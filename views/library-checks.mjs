// Library checks: the quality of what goes in and what comes out (library
// quality amendment of 2026-09-29). Three pages under the Library's Check
// menu, each a page of its own with Back to Library while it is open: record
// quality (what is missing or malformed, grouped by issue, with the mechanical
// fixes applied and undone as a batch), author and journal names (spellings
// that are probably one person or one journal, unified on the researcher's
// say-so), and cross-citations (which records cite which, from reference lists
// kept on the records so the graph is rebuilt offline). A fourth page, retractions and corrections, lists what Crossref and
// PubMed say of each record, when each was last checked, and which checks are older than the freshness set in Settings. A fifth,
// evidence changes, compares the project with the last evidence baseline kept and lists the work each change reaches.
import { get, update, getVersion } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { settings } from '../lib/model-settings.mjs';
import { figurePanel, showFigure, downloadCsv } from '../lib/figure.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiNotice } from '../lib/ui-actions.mjs';
import { disclosure, tableRegion } from '../lib/ui-components.mjs';
import { pageFrame, recordLink, changesPage } from './library-pages.mjs';
import { plural, day } from '../lib/dates.mjs';
import { checkRecords, qualitySummary, applyFixes, fixesFor, undoQualityFixes, journalClusters, applyJournalName, undoJournalName } from '../lib/library-quality.mjs';
import { authorClusters, applyAuthorNames, undoAuthorMerge, authorTable } from '../lib/author-names.mjs';
import { fetchReferences, saveReferences, crossCitations, citationArcSvg, crossCitationCsv } from '../lib/cross-citations.mjs';
import { checkRetractions, retractionSummary, checkState, freshDays, noticeLevel } from '../lib/integrity.mjs';
import { evidenceImpact, evidenceBaseline, analysisRegistry } from '../lib/research-copilot.mjs';
import { fields } from '../lib/fields.mjs';
import { results } from '../lib/results.mjs';
import { recordFingerprint } from '../lib/progress.mjs';

export const GROUP_PAGE = 10;
const ui = { kind: null, status: '', error: '', busy: false, severity: '', open: new Set(), pages: new Map(), parts: new Map() };
const SEVERITY = { error: 'Error', warn: 'Warning', note: 'Note' };
const SEVERITY_RANK = { error: 0, warn: 1, note: 2 };
export const LEVELS = Object.freeze([['', 'All issues'], ['error', 'Errors'], ['warn', 'Warnings'], ['note', 'Notes']]);
const KIND_TITLE = { quality: 'Record quality', authors: 'Author and journal names', citations: 'Cross-citations', retractions: 'Retractions and corrections', changes: 'Evidence changes' };

/**
 * Opens one of the pages ('quality', 'authors', 'citations', 'retractions', 'changes'); the Library closes its duplicate review when one is open.
 * `run`: the retractions page starts its check as it opens (the Library's Check retractions and the readiness row's Check now).
 */
export function openCheck(kind, { run = false } = {}) { ui.kind = kind; ui.status = ''; ui.error = ''; ui.severity = ''; ui.open = new Set(); ui.pages = new Map(); ui.parts = new Map(); ui.run = run; }
export const checkOpen = () => ui.kind;
export function closeCheck() { ui.kind = null; ui.status = ''; ui.error = ''; }

// The full check reads every record's text; a redraw without a change reuses it.
let checked = { version: -1, issues: [] };
const issuesNow = () => { const v = getVersion(); if (checked.version !== v) checked = { version: v, issues: checkRecords(get().papers || []) }; return checked.issues; };

const recordOf = id => (get().papers || []).find(p => p.id === id);
const clusterKey = c => c.variants.map(v => v.name).sort().join('|');
const slug = s => String(s).replace(/[^\w-]+/g, '-').slice(0, 60);
/** A part the person opened or closed stays as left across the page's redraws. */
const partOpen = (id, fallback = false) => (ui.parts.has(id) ? ui.parts.get(id) : fallback);
const notices = () => `${ui.error ? uiNotice({ id: 'lib-page-error', label: 'Problem', text: ui.error }) : ''}${ui.status ? uiNotice({ id: 'lib-page-status', label: 'Status', text: ui.status }) : ''}`;

export function checkPanelHtml() {
  if (!ui.kind) return '';
  return ui.kind === 'quality' ? qualityHtml() : ui.kind === 'authors' ? namesHtml() : ui.kind === 'retractions' ? retractionsHtml() : ui.kind === 'changes' ? changesHtml() : citationsHtml();
}

// ---- record quality ----------------------------------------------------------
const FIELD_NAME = { authors: 'author names' };
// What a group is called when its issues carry different messages ("Year 1700 is implausible", "DOI "x" is not a DOI").
const GROUP_TITLE = {
  'author-et-al': 'Author list carries "et al."', 'author-duplicate': 'Author listed twice', 'author-format': 'Author name without an initial',
  'year-implausible': 'Implausible year', 'doi-malformed': 'Malformed DOI', 'pmid-malformed': 'Malformed PMID', 'pages-short': 'Pages end short',
  retracted: 'Integrity notice', mojibake: 'Mis-decoded characters', whitespace: 'Stray whitespace' };
const groupKey = i => (i.kind === 'language' || i.kind === 'preprint' ? `${i.kind}:${i.message}` : `${i.kind}:${i.field}`);

/** The issues grouped by what is wrong, most serious first: [{ key, title, severity, issues }]. */
export function groupIssues(issues) {
  const by = new Map();
  for (const i of issues) { const k = groupKey(i); if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  const groups = [...by].map(([key, list]) => {
    const messages = new Set(list.map(i => i.message)), first = list[0];
    const severity = list.reduce((s, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[s] ? i.severity : s), first.severity);
    const field = FIELD_NAME[first.field] || first.field;
    const title = messages.size === 1 ? first.message : GROUP_TITLE[first.kind] ? `${GROUP_TITLE[first.kind]}${first.kind === 'mojibake' || first.kind === 'whitespace' ? ` in ${field}` : ''}` : first.message;
    return { key, title, severity, issues: list, varied: messages.size > 1 };
  });
  return groups.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.issues.length - a.issues.length || a.title.localeCompare(b.title));
}

const fixText = f => { const v = Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? ''); return v.length > 90 ? `${v.slice(0, 87)}…` : v; };
const issueRow = (i, n, group) => {
  const p = recordOf(i.paperId);
  const detail = [p?.year, group.varied ? i.message : '', i.fix ? `Becomes “${fixText(i.fix)}”` : ''];
  return uiRow({
    main: { html: recordLink(p), detail, wrap: true },
    end: i.fix
      ? uiRowEnd({ primary: { id: `check-fix-${n}`, label: 'Fix', attrs: { 'data-check-fix': i.paperId, 'data-kind': i.kind, 'data-field': i.field } },
        more: { label: `More for ${p?.label || 'this record'}`, attrs: { 'data-check-more': i.paperId } } })
      : uiRowEnd({ reserve: true }) });
};
function groupHtml(g) {
  const id = `chk-g-${slug(g.key)}`, open = ui.open.has(g.key);
  let body = '';
  if (open) {
    const view = pageOf(g.issues, ui.pages.get(g.key) || 1, GROUP_PAGE); ui.pages.set(g.key, view.page);
    body = `${uiList({ id: `${id}-rows`, label: g.title, rows: view.items.map((i, n) => issueRow(i, `${slug(g.key)}-${n}`, g)) })}${pager({ id: `chk-pager-${slug(g.key)}`, page: view.page, pages: view.pages, total: g.issues.length, label: 'records', size: GROUP_PAGE })}`;
  }
  return disclosure({ id, title: g.title, count: g.issues.length, meta: SEVERITY[g.severity], open, body, className: 'lib-check-group' });
}
function qualityHtml() {
  const s = get(), issues = issuesNow(), sum = qualitySummary(issues);
  const shown = ui.severity ? issues.filter(i => i.severity === ui.severity) : issues, groups = groupIssues(shown);
  const level = LEVELS.find(([k]) => k === ui.severity)?.[1] || LEVELS[0][1];
  const parts = [{ id: 'chk-records', text: `${plural((s.papers || []).length, 'record')} checked`, drop: 0 },
    { id: 'chk-error', text: plural(sum.bySeverity.error, 'error'), drop: 3 }, { id: 'chk-warn', text: plural(sum.bySeverity.warn, 'warning'), drop: 4 },
    { id: 'chk-note', text: plural(sum.bySeverity.note, 'note'), drop: 5 }];
  const tools = uiBar({ kind: 'tools', label: 'Issue level', id: 'chk-tools', actions: [{ picker: true, id: 'chk-level', label: 'Level', role: 'quiet', value: level, options: LEVELS }] });
  const body = groups.length ? groups.map(groupHtml).join('')
    : emptyState({ title: ui.severity ? 'Nothing at this level' : 'Nothing to fix', size: 'inline' });
  return pageFrame({ kind: 'quality', title: KIND_TITLE.quality, parts, tools, notices: notices(), body });
}

// ---- author and journal names ----------------------------------------------
const distinctKey = (kind, c) => (kind === 'journal' ? `journal:${clusterKey(c)}` : clusterKey(c));
const distinctLabel = key => key.replace(/^journal:/, '').split('|').join(' · ');
/** The later of the last author and journal unifications, so one command undoes the last change. */
function lastUnify(s) {
  const a = (s.authorMerges || []).at(-1), j = (s.journalMerges || []).at(-1);
  if (!a && !j) return null;
  return !j || (a && a.at >= j.at) ? { kind: 'author', at: a.at } : { kind: 'journal', at: j.at };
}
const NAME_KIND = { author: 'Authors', journal: 'Journals' };
function clusterRow(c, kind, i) {
  const why = kind === 'author' ? (c.confidence === 'high' ? 'Same name, different spelling' : 'Probably the same person') : 'One journal, several spellings';
  const key = clusterKey(c);
  return uiRow({
    main: { html: `<span class="lib-name-variants">${c.variants.map(v => `<span><strong>${esc(v.name)}</strong> <span class="meta">${v.count}</span></span>`).join('')}</span>`, detail: [NAME_KIND[kind], why, c.paperIds ? plural(c.paperIds.length, 'record') : ''], wrap: true },
    cells: [{ col: 'keep', kind: 'control', html: `<select data-name-pick aria-label="Spelling to keep">${c.variants.map(v => `<option value="${esc(v.name)}"${v.name === c.canonical ? ' selected' : ''}>Keep ${esc(v.name)}</option>`).join('')}</select>` }],
    end: uiRowEnd({ primary: { id: `name-unify-${kind}-${i}`, label: 'Unify', attrs: { 'data-name-apply': kind, 'data-key': key } },
      more: { label: `More for ${c.canonical || c.variants[0]?.name || 'this group'}`, attrs: { 'data-name-more': kind, 'data-key': key } } }) });
}
function namesHtml() {
  const s = get(), papers = s.papers || [];
  const dismissed = new Set(s.authorDistinct || []);
  const clusters = authorClusters(papers).filter(c => !dismissed.has(distinctKey('author', c)));
  const journals = journalClusters(papers).filter(c => !dismissed.has(distinctKey('journal', c)));
  const table = authorTable(papers), shown = table.slice(0, 40);
  const rows = [...clusters.map((c, i) => clusterRow(c, 'author', i)), ...journals.map((c, i) => clusterRow(c, 'journal', i))];
  const parts = [{ id: 'names-authors', text: `${plural(clusters.length, 'author')} to review`, drop: 0 }, { id: 'names-journals', text: `${plural(journals.length, 'journal')} to review`, drop: 3 },
    ...(dismissed.size ? [{ id: 'names-distinct', text: `${dismissed.size} marked distinct`, drop: 4 }] : [])];
  const years = a => (a.years[0] === a.years[1] ? String(a.years[0] || '') : `${a.years[0] || ''}–${a.years[1] || ''}`);
  const distinctRows = [...dismissed].map((k, i) => uiRow({ main: { html: `<span>${esc(distinctLabel(k))}</span>` },
    end: uiRowEnd({ primary: { id: `name-undistinct-${i}`, label: 'Undo', attrs: { 'data-name-undistinct': k } }, more: { label: `More for ${distinctLabel(k)}`, attrs: { 'data-name-undistinct-more': k } } }) }));
  const body = `${rows.length ? uiList({ id: 'names-rows', label: 'Spellings to unify', cols: ['keep'], rows })
      : emptyState({ title: 'No spellings to unify', size: 'inline' })}
    ${dismissed.size ? disclosure({ id: 'names-distinct-list', title: 'Distinct', count: dismissed.size, open: partOpen('names-distinct-list'), body: uiList({ id: 'names-distinct-rows', label: 'Marked distinct', rows: distinctRows }) }) : ''}
    ${disclosure({ id: 'names-authors-table', title: 'Authors in the library', count: table.length, open: partOpen('names-authors-table'),
      body: tableRegion({ label: 'Authors in the library', sticky: true, html: `<table class="lib-check-authors"><thead><tr><th class="grow">Author</th><th class="num">Records</th><th>Years</th></tr></thead><tbody>${shown.map(a => `<tr><td class="grow">${esc(a.name)}</td><td class="num">${a.count}</td><td>${esc(years(a))}</td></tr>`).join('')}</tbody></table>` }) })}`;
  return pageFrame({ kind: 'authors', title: KIND_TITLE.authors, parts, notices: notices(), body });
}

// ---- cross-citations -----------------------------------------------------------
const citedRow = (p, text) => uiRow({ main: { html: recordLink(p), detail: [p?.year, text] } });
function citationsHtml() {
  const s = get(), papers = s.papers || [];
  const g = crossCitations(papers);
  const resolved = papers.length - g.unresolved.length;
  const fetched = papers.map(p => p.openalex?.at).filter(Boolean).sort().at(-1);
  const parts = [{ id: 'cc-resolved', text: `${resolved} with reference lists`, drop: 0 }, { id: 'cc-edges', text: plural(g.edges.length, 'citation'), drop: 1 },
    { id: 'cc-missing', text: `${g.unresolved.length} not found in OpenAlex`, drop: 3 }, { id: 'cc-isolated', text: `${g.isolated.length} cite none`, drop: 5 },
    { id: 'cc-groups', text: plural(g.components.length, 'connected group'), drop: 6 }, ...(fetched ? [{ id: 'cc-read', text: `Read ${fetched.slice(0, 10)}`, drop: 7 }] : [])];
  const cited = g.mostCited.slice(0, 15).map(m => citedRow(recordOf(m.id), `cited by ${plural(m.n, 'record')} here`));
  const missing = g.unresolved.slice(0, 60).map(id => { const p = recordOf(id); return citedRow(p, p?.doi || p?.pmid ? 'Not indexed' : 'No DOI or PMID to look up'); });
  const body = resolved ? `<div class="panel-body tight">${figurePanel({ title: 'Citations within the library', id: 'check-arc' })}</div>
    ${cited.length ? disclosure({ id: 'cc-most-cited', title: 'Most cited within the library', count: cited.length, open: partOpen('cc-most-cited'), body: uiList({ id: 'cc-most-cited-rows', label: 'Most cited within the library', rows: cited }) }) : ''}
    ${missing.length ? disclosure({ id: 'cc-missing-list', title: 'Not found in OpenAlex', count: g.unresolved.length, open: partOpen('cc-missing-list'), body: uiList({ id: 'cc-missing-rows', label: 'Not found in OpenAlex', rows: missing }) }) : ''}`
    : emptyState({ icon: 'search', title: 'No citations looked up', help: true, detail: 'Reference lists come from OpenAlex, by DOI or PMID' });
  return pageFrame({ kind: 'citations', title: KIND_TITLE.citations, parts, notices: notices(), body });
}

// ---- retractions and corrections ------------------------------------------------
// One group per finding, the most serious first; the notices' groups open, the check-state groups closed. A group draws its rows when
// it opens, ten to a page, like the quality page's.
const NOTICE_NAME = n => String(n.type || 'notice').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const SOURCE_NAME = { crossref: 'Crossref', pubmed: 'PubMed' };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A notice's issued date as Crossref gives it ("2010-2-6", "2010-2", "2010"), as the interface writes a date. */
const noticeDate = d => { const [y, m, dd] = String(d || '').split('-').map(Number); return !y ? '' : dd ? day(new Date(y, m - 1, dd), 0) : m ? `${MONTH[m - 1]} ${y}` : String(y); };
const noticeDetail = n => [NOTICE_NAME(n), noticeDate(n.date), (n.sources || [n.source || 'crossref']).map(x => SOURCE_NAME[x] || x).join(', ')].filter(Boolean).join(' · ');
const checkedOn = p => (p.integrity?.checkedAt ? `Checked ${day(p.integrity.checkedAt)}` : '');
function retractionGroups() {
  const days = freshDays(settings()), sum = retractionSummary(get().papers || [], { now: Date.now(), days });
  const notices = level => p => (p.integrity?.notices || []).filter(n => noticeLevel(n.type) === level).map(noticeDetail);
  return [
    { key: 'retracted', title: 'Retracted', list: sum.retracted, open: true, detail: p => [p.year, ...notices('retraction')(p), checkedOn(p)] },
    { key: 'concern', title: 'Expression of concern', list: sum.concern, open: true, detail: p => [p.year, ...notices('concern')(p), checkedOn(p)] },
    { key: 'corrected', title: 'Corrected', list: sum.corrected, detail: p => [p.year, ...notices('correction')(p), checkedOn(p)] },
    { key: 'never', title: 'Never checked', list: sum.never, detail: p => [p.year, p.doi ? `DOI ${p.doi}` : `PMID ${p.pmid}`] },
    { key: 'stale', title: `Checked more than ${plural(days, 'day')} ago`, list: sum.stale, detail: p => [p.year, checkedOn(p)] },
    { key: 'unidentified', title: 'No DOI or PMID to check', list: sum.unidentified, detail: p => [p.year] },
  ].filter(g => g.list.length);
}
function retractionGroupHtml(g) {
  const id = `rw-g-${g.key}`, open = partOpen(id, g.open);
  let body = '';
  if (open) {
    const view = pageOf(g.list, ui.pages.get(id) || 1, GROUP_PAGE); ui.pages.set(id, view.page);
    body = `${uiList({ id: `${id}-rows`, label: g.title, rows: view.items.map(p => uiRow({ main: { html: recordLink(p), detail: g.detail(p), wrap: true } })) })}${pager({ id: `rw-pager-${g.key}`, page: view.page, pages: view.pages, total: g.list.length, label: 'records', size: GROUP_PAGE })}`;
  }
  return disclosure({ id, title: g.title, count: g.list.length, open, body, className: 'lib-rw-group' });
}
function retractionsHtml() {
  const papers = get().papers || [], days = freshDays(settings()), sum = retractionSummary(papers, { now: Date.now(), days });
  const parts = [{ id: 'rw-checked', text: `${sum.done.length + sum.stale.length} checked`, drop: 0 }, { id: 'rw-never', text: `${sum.never.length} never checked`, drop: 1 },
    { id: 'rw-stale', text: `${sum.stale.length} older than ${plural(days, 'day')}`, drop: 3 },
    { id: 'rw-notices', text: plural(sum.retracted.length + sum.concern.length + sum.corrected.length, 'record') + ' with notices', drop: 2 }];
  const groups = retractionGroups();
  const body = groups.length ? groups.map(retractionGroupHtml).join('')
    : emptyState({ icon: 'check', title: 'No records with notices' });
  return pageFrame({ kind: 'retractions', title: KIND_TITLE.retractions, parts, notices: notices(), body });
}
/** Checks the records that were never checked or whose check is stale; when none is due, every record with a DOI or PMID again. */
async function runRetractionCheck(refresh) {
  if (ui.busy) return;
  const papers = get().papers || [], days = freshDays(settings());
  const due = papers.filter(p => ['never', 'stale'].includes(checkState(p, { now: Date.now(), days })));
  const list = due.length ? due : papers.filter(p => checkState(p, { now: Date.now(), days }) !== 'unidentified');
  if (!list.length) { ui.error = 'No record has a DOI or PMID to check'; refresh(); return; }
  ui.busy = true; ui.error = ''; ui.status = `Checking ${plural(list.length, 'record')}`; refresh();
  const say = t => { ui.status = t; const st = document.querySelector('#lib-page-status p'); if (st) st.textContent = t; };
  try {
    const t = await checkRetractions(list, { settings: settings(), onProgress: (n, of) => say(`Checked ${n} of ${of}`) });
    ui.status = `${plural(t.checked, 'record')} checked · ${t.questioned} retracted or in question · ${t.flagged - t.questioned} corrected${t.failed ? ` · ${t.failed} not reached` : ''}`;
  } catch (err) { ui.status = ''; ui.error = `Could not check retractions: ${err.message}`; }
  ui.busy = false; refresh();
}

// ---- evidence changes ------------------------------------------------------------------------------------------------------------
// The comparison hashes every record, accepted value and paragraph: a redraw without a change reuses it.
let impact = { version: -1, value: null };
const impactNow = () => { const v = getVersion(); if (impact.version !== v) impact = { version: v, value: evidenceImpact(get()) }; return impact.value; };
const CHANGE = { 'new-record': 'New', 'changed-record': 'Changed', 'removed-record': 'Removed',
  'accepted-cell': 'Accepted value changed', 'result-token': 'Result changed', protocol: 'Protocol changed', certainty: 'Certainty judgments changed' };
const plain = text => `<span>${esc(text)}</span>`;
const sentence = t => String(t || '').replace(/\.$/, '');
/** Names for what the rows point at, read once per draw: field and study labels, results, analyses, paragraphs, the baseline's records. */
function rowNames(s) {
  const textOf = b => b.text ?? (b.runs || []).map(r => r.t).join('');
  return { s, before: new Map(((s.evidenceBaselines || []).at(-1)?.papers || []).map(p => [p.id, p])), fields: new Map(fields(s).map(f => [f.id, f.label || f.id])), results: new Map(results(s).map(r => [r.key, r.label])),
    analyses: new Map(analysisRegistry(s).map(a => [a.id, a.title])), blocks: new Map((s.manuscript?.blocks || []).map(b => [b.id, textOf(b)])) };
}
/** One row of either list: its name (a record as a link) and what tells it apart. */
function describe(item, names) {
  const study = id => recordOf(id)?.label || 'Removed record';
  if (item.kind in CHANGE) {
    if (item.paperId) {
      const p = recordOf(item.paperId), old = names.before.get(item.paperId), now = p && old && item.kind === 'changed-record' ? recordFingerprint(names.s, p) : null;
      const what = now ? [now.evidence !== old.evidence ? 'Details changed' : '', now.decision !== old.decision ? 'Decision changed' : ''] : [CHANGE[item.kind]];
      return { html: recordLink(p, 'Record no longer in the library'), detail: [p?.year, ...what] };
    }
    if (item.kind === 'accepted-cell') {
      const at = item.key.indexOf(':'), id = item.key.slice(at + 1), base = id.replace(/@arm\d+$/, ''), arm = /@arm(\d+)$/.exec(id)?.[1];
      return { html: plain(`${names.fields.get(base) || base}${arm ? ` (arm ${arm})` : ''} · ${study(item.key.slice(0, at))}`), detail: [CHANGE[item.kind]] };
    }
    if (item.kind === 'result-token') return { html: plain(names.results.get(item.key) || item.key), detail: [CHANGE[item.kind]] };
    return { html: plain(item.kind === 'protocol' ? 'Protocol' : 'Certainty judgments'), detail: [CHANGE[item.kind]] };
  }
  if (item.kind === 'analysis') return { html: plain(names.analyses.get(item.id) || 'Saved analysis'), detail: [item.status === 'stale' ? 'Inputs changed' : 'Not current', sentence(item.action)] };
  if (item.kind === 'manuscript') { const text = names.blocks.get(item.id) || ''; return { html: plain(text.length > 90 ? `${text.slice(0, 87)}…` : text || 'Manuscript paragraph'), detail: ['Manuscript paragraph', sentence(item.action)] }; }
  if (item.kind === 'evidence-review') return { html: plain(plural(item.n, 'changed record')), detail: ['Review screening, extraction and appraisal'] };
  return { html: plain('Certainty judgments'), detail: [sentence(item.action)] };
}
function changesHtml() {
  const found = impactNow(), names = rowNames(get());
  // one row for the changed records' review, in its place: each record is already a row of Changes
  const reviews = found.affected.filter(a => a.kind === 'evidence-review').length;
  const affected = [];
  let merged = false;
  for (const a of found.affected) if (a.kind !== 'evidence-review') affected.push(a); else if (!merged) { merged = true; affected.push({ kind: a.kind, n: reviews }); }
  const now = { ...found, affected };
  const view = (key, list) => { const v = pageOf(list, ui.pages.get(key) || 1, GROUP_PAGE); ui.pages.set(key, v.page); return v; };
  return changesPage({ impact: now, changes: view('ev-changes', now.changes), affected: view('ev-affected', now.affected), size: GROUP_PAGE,
    describe: item => describe(item, names), open: { 'ev-changes': partOpen('ev-changes', true), 'ev-affected': partOpen('ev-affected', true) }, notices: notices() });
}
/** Keeps the project as it is now as the baseline later changes are compared with, on the person's say-so. */
async function captureBaseline(refresh) {
  const b = evidenceBaseline(get());
  if (!await confirmAsk('Capture an evidence baseline?', { detail: `${plural(b.papers.length, 'record')}, ${plural(Object.keys(b.values).length, 'accepted value')} and ${plural(b.analyses.length, 'analysis', 'analyses')}. Later changes are listed against it.`, confirm: 'Capture' })) return;
  update(s => { s.evidenceBaselines = [...(s.evidenceBaselines || []), evidenceBaseline(s)]; return s; });
  ui.pages = new Map(); refresh('Baseline captured');
}

// ---- the title bar ------------------------------------------------------------------------------------------------------------
async function fixAll(refresh) {
  const issues = issuesNow().filter(i => i.fix);
  if (!await confirmAsk(`Apply ${plural(issues.length, 'mechanical fix', 'mechanical fixes')}?`, { detail: 'Identifiers, markup, whitespace and author entries; each is logged and can be undone.', confirm: 'Fix' })) return;
  let n = 0; update(s => { n = applyFixes(s, issues).applied; return s; });
  refresh(`${plural(n, 'fix', 'fixes')} applied`);
}
async function readReferenceLists(refresh) {
  if (ui.busy) return;
  const papers = (get().papers || []).filter(p => p.doi || p.pmid);
  if (!papers.length) { ui.error = 'No record has a DOI or PMID to look up'; refresh(); return; }
  ui.busy = true; ui.error = ''; ui.status = `Looking up ${plural(papers.length, 'record')}`; refresh();
  try {
    const { found, missing } = await fetchReferences(papers, { settings: settings(), onProgress: t => { ui.status = t; const st = document.querySelector('#lib-page-status p'); if (st) st.textContent = t; } });
    update(s => saveReferences(s, found));
    ui.status = `${plural(found.length, 'reference list')} read · ${missing.length} not found`;
  } catch (err) { ui.status = ''; ui.error = `Could not read reference lists: ${err.message}`; }
  ui.busy = false; refresh();
}
/**
 * The open page's name and commands, for the title bar (views/library.mjs page(), which adds Back to Library). `refresh(msg)` repaints
 * the page with its bar. Only the page's own commands: what acts on one row or group stays on it.
 */
export function checkPage(refresh) {
  const s = get(), papers = s.papers || [], title = KIND_TITLE[ui.kind] || 'Check';
  if (ui.kind === 'quality') {
    const sum = qualitySummary(issuesNow());
    return { title, actions: sum.fixable ? [{ id: 'check-fix-all', label: `Apply ${plural(sum.fixable, 'fix', 'fixes')}`, icon: 'check', role: 'primary', run: () => fixAll(refresh) }] : [],
      overflow: (s.qualityLog || []).length ? [{ id: 'check-undo-fixes', label: 'Undo last fixes', run: () => { const last = (get().qualityLog || []).at(-1)?.at; if (!last) return; update(x => undoQualityFixes(x, last)); refresh('Fixes undone'); } }] : [] };
  }
  if (ui.kind === 'authors') {
    return { title, actions: [], overflow: lastUnify(s) ? [{ id: 'check-undo-names', label: 'Undo last change', run: () => {
      const last = lastUnify(get()); if (!last) return;
      update(x => (last.kind === 'author' ? undoAuthorMerge(x, last.at) : undoJournalName(x, last.at))); refresh('Spellings restored');
    } }] : [] };
  }
  if (ui.kind === 'citations') {
    const g = crossCitations(papers), resolved = papers.length - g.unresolved.length;
    return { title, actions: [{ id: 'check-fetch-refs', label: 'Read reference lists', icon: 'refresh', disabled: ui.busy, role: resolved ? 'secondary' : 'primary', run: () => readReferenceLists(refresh) }],
      overflow: g.edges.length ? [{ id: 'check-cites-csv', label: 'Export', run: () => downloadCsv(crossCitationCsv(crossCitations(get().papers || []), get().papers || []), 'cross-citations.csv') }] : [] };
  }
  if (ui.kind === 'changes') return { title, actions: [{ id: 'check-baseline', label: 'Capture baseline', icon: 'backup', role: 'primary', run: () => captureBaseline(refresh) }], overflow: [] };
  const sum = retractionSummary(papers, { now: Date.now(), days: freshDays(settings()) });
  return { title, actions: [{ id: 'check-retractions-run', label: 'Check now', icon: 'refresh', role: 'primary', disabled: ui.busy || sum.never.length + sum.stale.length + sum.done.length === 0, run: () => runRetractionCheck(refresh) }], overflow: [] };
}

/** Handlers for whichever page is open; the Library redraws on each change. */
export function wireCheckPanel(el, ctx) {
  const refresh = msg => ctx.rerender(msg);
  const show = id => { const p = recordOf(id); ctx.showStudy?.(id, Boolean(p?.pdf)); };
  el.querySelectorAll('.lib-page > details.ui-disclosure[id]:not(.lib-check-group):not(.lib-rw-group)').forEach(d => d.addEventListener('toggle', () => ui.parts.set(d.id, d.open)));
  el.querySelectorAll('[data-check-open]').forEach(b => b.onclick = () => show(b.dataset.checkOpen));

  // --- quality: groups open in place, one fix (with the fixes before it on that field), all fixes, undo ---
  const level = el.querySelector('#chk-level');
  if (level) {
    const set = value => { ui.severity = value; ui.pages = new Map(); refresh(); };
    level.onclick = () => showMenu(level, LEVELS.map(([k, label]) => ({ label, checked: k === ui.severity, run: () => set(k) })), { align: 'end' });
    level.addEventListener('ui-pick', e => set(e.detail.value));
  }
  const visibleGroups = () => groupIssues(ui.severity ? issuesNow().filter(i => i.severity === ui.severity) : issuesNow());
  const wirePagers = root => { for (const g of visibleGroups()) wirePager(root, `chk-pager-${slug(g.key)}`, n => { ui.pages.set(g.key, n); refresh(); }); };
  // the rows of a group are drawn when it opens, so a long list of groups stays short
  const wireGroup = d => d.addEventListener('toggle', () => {
    const g = visibleGroups().find(x => `chk-g-${slug(x.key)}` === d.id);
    if (!g || d.open === ui.open.has(g.key)) return;
    if (d.open) ui.open.add(g.key); else ui.open.delete(g.key);
    if (!d.open) return;
    const next = new DOMParser().parseFromString(groupHtml(g), 'text/html').body.firstElementChild;
    d.replaceWith(next);
    wireCheckPanel(next, ctx); wireGroup(next);
  });
  el.querySelectorAll('.lib-check-group').forEach(wireGroup);
  wirePagers(el);
  el.querySelectorAll('[data-check-fix]').forEach(b => b.onclick = () => {
    const issues = fixesFor(issuesNow(), b.dataset.checkFix, b.dataset.kind, b.dataset.field);
    let n = 0; update(s => { n = applyFixes(s, issues).applied; return s; });
    refresh(`${plural(n, 'fix', 'fixes')} applied`);
  });
  el.querySelectorAll('[data-check-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Show record', icon: 'open', run: () => show(b.dataset.checkMore) }], { align: 'end' }));

  // --- names: unify, distinct, undo ---
  el.querySelectorAll('[data-name-apply]').forEach(b => b.onclick = () => {
    const kind = b.dataset.nameApply, key = b.dataset.key, pick = b.closest('.ui-row').querySelector('[data-name-pick]').value;
    const list = kind === 'author' ? authorClusters(get().papers || []) : journalClusters(get().papers || []);
    const c = list.find(x => clusterKey(x) === key); if (!c) { refresh('That group has changed'); return; }
    const variants = c.variants.map(v => v.name).filter(v => v !== pick);
    update(s => (kind === 'author' ? applyAuthorNames(s, { variants, canonical: pick }) : applyJournalName(s, { variants, canonical: pick })));
    refresh(`${plural(variants.length, 'spelling')} now ${pick}`);
  });
  const markDistinct = (kind, key) => {
    const stored = kind === 'journal' ? `journal:${key}` : key;
    update(s => { s.authorDistinct = [...new Set([...(s.authorDistinct || []), stored])]; return s; }); refresh();
  };
  el.querySelectorAll('[data-name-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Distinct', run: () => markDistinct(b.dataset.nameMore, b.dataset.key) }], { align: 'end' }));
  const undistinct = key => { update(s => { s.authorDistinct = (s.authorDistinct || []).filter(k => k !== key); return s; }); refresh(); };
  el.querySelectorAll('[data-name-undistinct]').forEach(b => b.onclick = () => undistinct(b.dataset.nameUndistinct));
  el.querySelectorAll('[data-name-undistinct-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Undo', icon: 'undo', run: () => undistinct(b.dataset.nameUndistinctMore) }], { align: 'end' }));

  // --- retractions: check now (the title bar's, and as the page opens when asked), groups open in place, pages ---
  if (ui.kind === 'retractions' && el.querySelector('#lib-page')) {
    for (const g of retractionGroups()) wirePager(el, `rw-pager-${g.key}`, n => { ui.pages.set(`rw-g-${g.key}`, n); refresh(); });
    el.querySelectorAll('.lib-rw-group').forEach(function wireRw(d) {
      d.addEventListener('toggle', () => {
        const g = retractionGroups().find(x => `rw-g-${x.key}` === d.id);
        if (!g || d.open === partOpen(d.id, g.open)) return;
        ui.parts.set(d.id, d.open);
        if (!d.open) return;
        const next = new DOMParser().parseFromString(retractionGroupHtml(g), 'text/html').body.firstElementChild;
        d.replaceWith(next); wireCheckPanel(next, ctx); wirePager(next, `rw-pager-${g.key}`, n => { ui.pages.set(d.id, n); refresh(); }); wireRw(next);
      });
    });
    if (ui.run) { ui.run = false; queueMicrotask(() => runRetractionCheck(refresh)); }
  }

  // --- evidence changes: the two lists' pages (the disclosures keep their state through the toggle listener above) ---
  if (ui.kind === 'changes') for (const key of ['ev-changes', 'ev-affected']) wirePager(el, `${key}-pager`, n => { ui.pages.set(key, n); refresh(); });

  // --- citations: the arc (reading the lists and exporting them are the title bar's) ---
  const arc = el.querySelector('#check-arc');
  if (arc) {
    const papers = get().papers || [], g = crossCitations(papers);
    showFigure(el, 'check-arc', citationArcSvg(g, papers, { width: Math.max(560, Math.min(960, (arc.clientWidth || 720) - 16)) }), 'cross-citations', { open: show });
  }
}

// A review's documented process as saved workflows, and the work it already
// did as their run history (workflow history amendment of 2026-09-28).
//
// Pure over plain objects. The converters turn what a project and its folder
// record — the search log and export notes, Jev screening runs, full-text
// decisions, the evidence table's revision log — into runs marked imported.
// A number enters a run only when a source states it; a time only when a
// source records it (a date alone is kept as a date). Imported runs are read
// only: flow-runner refuses to re-run them.
import { arrangeGraph } from './flow-graph.mjs';
import { recordVersion, versionSnapshot } from './flow-versions.mjs';
import { isJev } from './jev.mjs';
import { settingsOf } from './app-settings.mjs';
import { when, day } from './dates.mjs';
import { BLOCK_DEFAULTS } from './flow-blocks.mjs';

export const HISTORY_MESSAGE = 'Defined from the review’s documented process';
export const HISTORY_ORIGIN = 'folder-history';
const uuid = () => crypto.randomUUID();
const base = p => String(p || '').split('/').pop();
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const iso = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null; };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "19 September 2026" or "26 Sep 2026" as a date-only ISO stamp (noon UTC keeps the calendar day). */
export function dateOnly(text) {
  const m = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(String(text || ''));
  if (!m) return null;
  const month = MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase().slice(0, 3)));
  return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}T12:00:00.000Z`;
}
const isDateOnly = at => /T12:00:00\.000Z$/.test(String(at || ''));
const SITE_ID = { 'Web of Science': 'wos', Scopus: 'scopus', PubMed: 'pubmed' };
const sourceName = raw => /web of science/i.test(raw) ? 'Web of Science' : /scopus/i.test(raw) ? 'Scopus' : /pubmed/i.test(raw) ? 'PubMed' : String(raw || '').trim();

// ---- the workflows -----------------------------------------------------------

function flowOf(key, name, blocks, links, extra = {}) {
  const full = blocks.map(b => ({ ...BLOCK_DEFAULTS, executor: 'automatic', review: false, ...b }));
  const flow = { id: uuid(), name, blocks: full, edges: links.map(([a, b]) => ({ from: a, to: b })), cron: '', enabled: false, concurrency: 3, origin: `${HISTORY_ORIGIN}:${key}`, ...extra };
  flow.blocks = arrangeGraph(flow);
  return flow;
}
/** The configured Jev and text model profiles, for the blocks that need one. */
export function modelIds(settings = {}) {
  const profiles = settings.models?.profiles?.length ? settings.models.profiles : settings.ai?.provider ? [{ ...settings.ai, id: 'legacy' }] : [];
  const usable = profiles.filter(p => p.provider && p.model);
  return { jev: usable.find(p => isJev(p))?.id || '', text: usable.find(p => !isJev(p))?.id || '' };
}
const searchBlocks = queries => ['PubMed', 'Web of Science', 'Scopus'].filter(s => queries[s])
  .map(s => ({ id: SITE_ID[s], type: 'search', label: s, source: SITE_ID[s], query: queries[s], limit: 100 }));

/**
 * The five workflows of a review run the way a documented review runs: its
 * documented searches, a weekly watch of them, three-pass title/abstract
 * screening, full-text review with extraction, and the evidence-table release.
 */
export function historyWorkflows({ queries = {}, models = {} } = {}) {
  const searches = searchBlocks(queries), ids = searches.map(b => b.id);
  const intake = (key, name, tail, links, extra) => flowOf(key, name, [...searches,
    { id: 'dedupe', type: 'dedupe', label: 'Remove duplicates' }, { id: 'new', type: 'new_records', label: 'New records' },
    { id: 'save', type: 'collect', label: 'Save to library', review: true }, ...tail],
  [...ids.map(id => [id, 'dedupe']), ['dedupe', 'new'], ['new', 'save'], ...links], extra);
  const passes = ['1', '2', '3'].map(n => ({ id: `pass${n}`, type: 'screen_pass', label: `Screening pass ${n}`, passNumber: n, modelId: models.jev || '' }));
  return {
    search: searches.length ? intake('search', 'Documented literature search', [], []) : null,
    watch: searches.length ? intake('watch', 'Literature watch', [{ id: 'notify', type: 'notify', label: 'Notify', text: 'Literature watch: {{count}} new records saved' }], [['save', 'notify']], { cron: '0 9 * * 1' }) : null,
    screening: flowOf('screening', 'Title/abstract screening', [
      { id: 'library', type: 'library', label: 'Library' }, { id: 'fanout', type: 'fanout', label: 'Three independent passes' }, ...passes,
      { id: 'consensus', type: 'consensus', label: 'Consensus' }, { id: 'sheet', type: 'screening_sheet', label: 'Screening sheet' }],
    [['library', 'fanout'], ['fanout', 'pass1'], ['fanout', 'pass2'], ['fanout', 'pass3'], ['pass1', 'consensus'], ['pass2', 'consensus'], ['pass3', 'consensus'], ['consensus', 'sheet']]),
    fulltext: flowOf('fulltext', 'Full-text review and extraction', [
      { id: 'library', type: 'library', label: 'Library' }, { id: 'ta', type: 'dual_review', label: 'Included at title/abstract', stage: 'ta' },
      { id: 'ft', type: 'dual_review', label: 'Full-text review', stage: 'ft' }, { id: 'extract', type: 'extraction', label: 'Extraction proposals', modelId: models.text || '' },
      { id: 'sheet', type: 'screening_sheet', label: 'Screening sheet' }],
    [['library', 'ta'], ['ta', 'ft'], ['ft', 'extract'], ['extract', 'sheet']]),
    release: flowOf('release', 'Evidence table release', [
      { id: 'library', type: 'library', label: 'Library' },
      { id: 'revise', type: 'task', label: 'Revise the evidence table', executor: 'human', instructions: 'Check each change against the paper, edit both workbooks, add a round to the revision log and bump the table version.' },
      { id: 'prisma', type: 'prisma', label: 'PRISMA counts' }, { id: 'sheet', type: 'screening_sheet', label: 'Screening sheet' },
      { id: 'notify', type: 'notify', label: 'Notify', text: 'Evidence table revised' }],
    [['library', 'revise'], ['revise', 'prisma'], ['prisma', 'sheet'], ['sheet', 'notify']]),
  };
}

// ---- runs --------------------------------------------------------------------

/**
 * One imported run of `flow`. `blocks` maps a block id to what the source
 * records for it: { input, output, text, reused, durationMs, at, log: [{at, message}] }.
 * A block with no entry is left without a state: the run shows it as not recorded.
 */
export function importedRun(flow, { number, at = null, endedAt, by = '', source = '', summary = '', note = '', superseded = false, tableVersion = '', durationMs, blocks = {}, importedAt = new Date().toISOString() }) {
  const run = { id: uuid(), flowId: flow.id, name: flow.name, flow: versionSnapshot(flow), at, endedAt: endedAt ?? at, status: 'done', engineVersion: 2,
    trigger: 'imported', imported: { source, at: importedAt, ...(note ? { note } : {}) }, by, number, version: 1,
    ...(isDateOnly(at) ? { dateOnly: true } : {}), ...(superseded ? { superseded: true } : {}), ...(tableVersion ? { tableVersion } : {}), ...(durationMs != null ? { durationMs } : {}),
    summary, steps: [], outputs: {}, texts: {}, payloads: {}, nodeStates: {}, nodeDetails: {}, nodeLogs: {}, pendingNodes: {}, approvals: {}, children: {}, next: flow.blocks.length };
  for (const b of flow.blocks) {
    const x = blocks[b.id]; if (!x) continue;
    run.nodeStates[b.id] = 'done';
    const d = {}; if (x.input != null) d.inputCount = x.input; if (x.output != null) d.outputCount = x.output; if (x.reused) d.reused = true; if (x.durationMs != null) d.durationMs = x.durationMs; if (x.at) d.endedAt = x.at;
    run.nodeDetails[b.id] = d; run.outputs[b.id] = []; run.texts[b.id] = x.text || '';
    run.nodeLogs[b.id] = (x.log || []).filter(Boolean).map(l => typeof l === 'string' ? { at: null, event: 'imported', message: l } : { at: l.at || null, event: 'imported', message: l.message });
    run.steps.push({ nodeId: b.id, type: b.type, count: x.output ?? null, text: x.text || '', at: x.at || at, imported: true });
  }
  return run;
}

/** "PubMed: 193 records." / "Web of Science: 391 records; …; Web_of_Science_391_records.ris" → per-source counts and files. */
export function parseSearchCounts(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(PubMed|Web of Science(?: Core Collection)?|Scopus)\s*:\s*(\d[\d,]*)\s+records\b(.*)$/i.exec(line);
    if (!m) continue;
    const file = /([\w.-]+\.(?:ris|nbib|txt|csv))\s*$/i.exec(m[3])?.[1] || '';
    out.push({ source: sourceName(m[1]), records: Number(m[2].replace(/,/g, '')), file, line: line.trim() });
  }
  return out;
}
/** The reference manager / screening tool import note: per-source duplicates, totals, the collection count. */
export function parseImportLog(text) {
  const t = String(text || ''), per = [];
  for (const m of t.matchAll(/^\s*(PubMed|Scopus|Web of Science)\s*:\s*(\d+)\s+references;\s*(\d+)\s+duplicates;\s*(\d+)\s+added/gim))
    per.push({ source: sourceName(m[1]), references: +m[2], duplicates: +m[3], added: +m[4] });
  const total = /Total:\s*(\d+)\s+references;\s*(\d+)\s+automatically detected duplicates;\s*(\d+)\s+records awaiting screening/i.exec(t);
  const items = /(\d+)\s+items verified in the collection/i.exec(t);
  const tool = /^(Covidence|Rayyan|EPPI[\w-]*)\b/im.exec(t)?.[1] || '';
  return { per, total: total ? { references: +total[1], duplicates: +total[2], awaiting: +total[3], line: total[0] } : null,
    collectionItems: items ? +items[1] : null, tool, date: dateOnly(/completed\s+(.+)$/im.exec(t)?.[1]) };
}

/**
 * A database search as a run: one search block per source with its retrieved
 * count and export time, then what the import note records for duplicates and
 * the saved records. `superseded` marks a search the review replaced.
 */
const ORDER = ['PubMed', 'Web of Science', 'Scopus'];
export function searchesToRun(flow, { number, searches: given = [], mtimes = {}, date = null, importLog = null, importAt = null, prisma = null, superseded = false, note = '', source = '' }) {
  const searches = [...given].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source)), blocks = {}, times = [];
  for (const s of searches) {
    const id = SITE_ID[s.source]; if (!id || !flow.blocks.some(b => b.id === id)) continue;
    const at = iso(mtimes[s.file]) || null; if (at) times.push(at);
    blocks[id] = { output: s.records, at,
      log: [s.line ? { at, message: s.line } : null, s.file ? { at, message: `Export: ${base(s.file)}${at ? ' (file saved)' : ''}` } : null] };
  }
  if (importLog?.total && !superseded) {
    const t = importLog.total, tool = importLog.tool || 'Import';
    blocks.dedupe = { input: t.references, output: t.awaiting, at: importAt, text: `${plural(t.duplicates, 'duplicate')} removed`,
      log: [...importLog.per.map(p => ({ at: importAt, message: `${tool}, ${p.source}: ${p.references} references; ${p.duplicates} duplicates; ${p.added} added` })),
        { at: importAt, message: `${tool}: ${t.line}` },
        prisma?.duplicates != null ? { at: null, message: `PRISMA counts: ${prisma.duplicates} duplicates; ${prisma.records_screened ?? '—'} records screened` } : null] };
    blocks.save = { input: t.awaiting, output: t.awaiting, at: importAt, text: `${plural(t.awaiting, 'record')} awaiting screening`,
      log: [importLog.collectionItems != null ? { at: importAt, message: `${importLog.collectionItems} items verified in the reference collection; duplicates not merged` } : null,
        { at: importAt, message: `${tool}: ${t.awaiting} records awaiting screening` }] };
    if (importAt) times.push(importAt);
  }
  const sorted = times.sort(), total = searches.reduce((n, s) => n + (s.records || 0), 0);
  return importedRun(flow, { number, at: sorted[0] || date, endedAt: sorted.at(-1) || date, source, superseded, note, blocks,
    summary: [superseded ? 'Superseded' : '', `${searches.map(s => `${s.source} ${s.records}`).join(', ')}; ${plural(total, 'record')} before deduplication`,
      !superseded && importLog?.total ? `${importLog.total.awaiting} after duplicates` : ''].filter(Boolean).join('; ') });
}

/**
 * A recorded Jev screening run as a run of the three-pass workflow. A run that
 * reprocessed saved responses keeps the passes' earlier output; a job's start
 * gives a duration only when it began after the previous run ended.
 */
export function jevRunToRun(flow, jev, { number, job = null, previousAt = null, source = 'Project screening runs' }) {
  const reused = /no new model calls/i.test(jev.summary || ''), n = jev.total ?? null, at = jev.at;
  const start = job?.startedAt && job.startedAt < at && (!previousAt || job.startedAt > previousAt) ? job.startedAt : null;
  const pass = { input: n, output: n, reused, log: [reused ? { at, message: 'Saved responses reused; no new model calls' } : { at, message: `Model ${jev.model || 'not recorded'}` },
    jev.rulesSnapshot ? { at, message: `Criteria fingerprint ${jev.rulesSnapshot}` } : null] };
  const blocks = { library: n != null ? { output: n } : {}, fanout: n != null ? { input: n, output: n } : {}, pass1: pass, pass2: pass, pass3: pass,
    consensus: { input: n, output: n, at, text: jev.summary || '' } };
  return importedRun(flow, { number, at, endedAt: at, source, summary: jev.summary || '', blocks, ...(start ? { durationMs: Date.parse(at) - Date.parse(start), at: start, endedAt: at } : {}) });
}

/** Recorded decisions of one stage, grouped by the time (or, for a sheet's date column, the day) they were recorded. */
export function decisionsToRuns(flow, log = [], { stage = 'ft', blockId = 'ft', names = {}, firstNumber = 1 } = {}) {
  const groups = new Map();
  for (const e of log) {
    if (e.action !== 'decide' || e.stage !== stage || !e.at) continue;
    const key = [isDateOnly(e.at) ? e.at : String(e.at).slice(0, 16), e.via || '', e.source || '', e.by || ''].join('|');
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e);
  }
  return [...groups.values()].sort((a, b) => String(a[0].at).localeCompare(String(b[0].at))).map((list, i) => {
    const inc = list.filter(e => e.decision === 'include').length, exc = list.filter(e => e.decision === 'exclude').length;
    const reasons = {}; for (const e of list) if (e.decision === 'exclude' && e.reason) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
    const at = list.map(e => e.at).sort()[0], end = list.map(e => e.at).sort().at(-1), who = list[0].by || '';
    const from = list[0].source ? base(list[0].source) : list[0].via === 'file' ? 'a decisions file' : '';
    return importedRun(flow, { number: firstNumber + i, at, endedAt: isDateOnly(at) ? at : end, by: names[who] || who, source: from ? `Screening log: ${from}` : 'Screening log',
      summary: `${plural(list.length, 'full-text decision')}, ${inc} included, ${exc} excluded`,
      blocks: { [blockId]: { input: list.length, output: inc, at: isDateOnly(end) ? null : end, text: `${inc} included, ${exc} excluded`,
        log: [{ at: isDateOnly(at) ? null : at, message: `${plural(list.length, 'decision')} recorded${who ? ` by ${who}` : ''}${from ? ` from ${from}` : ''}` },
          ...Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, c]) => ({ at: null, message: `Excluded (${r}): ${c}` }))] } } });
  });
}

/**
 * The evidence table's revision log — rows of [request, implementation] — as
 * rounds. Numbered items before "Round 2" are round 1 (the first requests);
 * "Round N: title" rows group into round N. The table version is taken from a
 * round's own text ("version v12"); a date only from `versionDates`.
 */
export function revisionRounds(rows = []) {
  const rounds = new Map(); let heading = '';
  for (const [a, b] of rows) {
    const req = String(a ?? '').trim(), impl = String(b ?? '').trim(); if (!req) continue;
    if (/^(verification|old id)/i.test(req)) break;
    const round = /^Round\s+(\d+)\s*:\s*(.*)$/i.exec(req), item = /^\d+\.\s+(.*)$/.exec(req);
    if (!round && !item) { if (!rounds.size) heading = req; continue; }
    const n = round ? Number(round[1]) : 1, title = round ? round[2] : item[1];
    if (!rounds.has(n)) rounds.set(n, { round: n, items: [] });
    rounds.get(n).items.push({ title, text: impl });
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round).map(r => {
    const version = /\bversion\s+v(\d+)\b|\brenamed to v(\d+)\b/i.exec(r.items.map(i => i.text).join(' '));
    return { ...r, heading: r.round === 1 ? heading : '', version: version ? `v${version[1] || version[2]}` : '' };
  });
}
/** "v12 (26 Sep 2026: …)" in a folder guide → { v12: date }. */
export function versionDates(guide = '') {
  const out = {};
  for (const m of String(guide).matchAll(/\*{0,2}v(\d+)\*{0,2}\s*\((\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/g)) out[`v${m[1]}`] ||= dateOnly(m[2]);
  return out;
}
export function revisionRowsToRuns(flow, rows, { dates = {}, source = 'Revision log' } = {}) {
  return revisionRounds(rows).map(r => {
    const title = r.round === 1 ? `${r.heading || 'Requests'} (${plural(r.items.length, 'item')})` : r.items.map(i => i.title).join('; ');
    const text = r.items.map(i => `${i.title}\n${i.text}`).join('\n\n');
    const at = r.version ? dates[r.version] || null : null;
    return importedRun(flow, { number: r.round, at, source, tableVersion: r.version, summary: `Round ${r.round}: ${title}`,
      blocks: { revise: { text } } });
  });
}

// ---- the set for a project -----------------------------------------------------

const find = (files, re) => files.find(f => re.test(f.path) && !/(^|\/)Old versions\//i.test(f.path));
/**
 * The workflows and their imported runs for a project, from its state and
 * what its folder holds: `files` are [{ path, mtime, text? }] (text for the
 * small notes the search left), `revisionRows` the evidence table's revision
 * log, `jobs` the app's job records when they survive (for durations).
 */
export function buildHistorySet(state, { files = [], revisionRows = [], jobs = state?.jobs || [], author, now = new Date().toISOString() } = {}) {
  const s = state || {}, mtimes = Object.fromEntries(files.filter(f => f.mtime).map(f => [f.path, f.mtime]));
  const text = re => find(files, re)?.text || '';
  const queries = {};
  for (const r of s.searches || []) if (SITE_ID[sourceName(r.source)] && r.query) queries[sourceName(r.source)] = r.query;
  const flows = historyWorkflows({ queries, models: modelIds(settingsOf(s)) });
  const runs = [], report = [];
  const add = (key, list, from) => { if (!flows[key] || !list.length) return; runs.push(...list); report.push({ workflow: flows[key].name, runs: list.length, from }); };

  // searches: the superseded broader exports, then the documented strategy
  if (flows.search) {
    const readme = parseSearchCounts(text(/(^|\/)Export_README\.txt$/i)), correction = text(/(^|\/)Strategy_correction_note\.txt$/i);
    const exact = text(/(^|\/)Exact_strategy_search_log\.txt$/i), importFile = find(files, /import_log\.txt$/i);
    const importLog = importFile?.text ? parseImportLog(importFile.text) : null;
    const exactLines = parseSearchCounts(exact);
    const dir = p => (find(files, new RegExp(`(^|/)${base(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))?.path) || p;
    const list = [];
    const exportDate = dateOnly(/export date:\s*(.+)$/im.exec(text(/(^|\/)Export_README\.txt$/i))?.[1]);
    if (readme.length) list.push(searchesToRun(flows.search, { number: 1, searches: readme.map(r => ({ ...r, file: dir(r.file) })), mtimes, date: exportDate, superseded: /supersede|expanded query/i.test(correction + exact),
      note: (/^[^.]*expanded (?:query|queries)[^.]*\./im.exec(correction)?.[0] || '').trim(), source: 'Export_README.txt, Strategy_correction_note.txt' }));
    const documented = (s.searches || []).filter(r => SITE_ID[sourceName(r.source)] && r.retrieved != null)
      .map(r => ({ source: sourceName(r.source), records: r.retrieved, file: r.file || '', line: exactLines.find(l => l.source === sourceName(r.source))?.line || '' }));
    if (documented.length) list.push(searchesToRun(flows.search, { number: list.length + 1, searches: documented, mtimes, date: dateOnly(/export date:\s*(.+)$/im.exec(exact)?.[1]) || (documented.length ? (s.searches[0].at || null) : null),
      importLog, importAt: iso(importFile?.mtime) || importLog?.date || null, prisma: s.prisma, source: 'Search log: Exact_strategy_search_log.txt, import log' }));
    add('search', list, 'search log and export notes');
  }
  // title/abstract screening: the recorded Jev runs, oldest first
  const jev = [...(s.jevRuns || [])].filter(r => r.at).sort((a, b) => a.at.localeCompare(b.at));
  add('screening', jev.map((r, i) => jevRunToRun(flows.screening, r, { number: i + 1, job: (jobs || []).find(j => j.id === r.id), previousAt: jev[i - 1]?.at })), 'Jev screening runs');
  // full-text review: decisions as recorded
  const names = {}; const initials = String(settingsOf(s).reviewerInitials || '').replace(/[^A-Za-zÀ-ž]/g, '');
  if (initials && settingsOf(s).reviewerName) names[initials] = settingsOf(s).reviewerName;
  add('fulltext', decisionsToRuns(flows.fulltext, s.screeningLog || [], { stage: 'ft', blockId: 'ft', names }), 'full-text decisions');
  // evidence table: one run per revision round
  add('release', revisionRowsToRuns(flows.release, revisionRows, { dates: versionDates(text(/(^|\/)AGENTS\.md$/i)), source: 'Revision log' }), 'revision log');

  const who = author || settingsOf(s).reviewerName || 'You';
  const workflows = Object.values(flows).filter(Boolean);
  const versions = Object.fromEntries(workflows.map(f => [f.id, recordVersion([], f, { author: who, message: HISTORY_MESSAGE, at: now }).versions]));
  for (const r of runs) r.imported.at = now;
  return { workflows, versions, runs, report };
}

/** Whether this project already has workflows set up from its history. */
export const hasHistoryWorkflows = s => (s?.workflows || []).some(f => String(f.origin || '').startsWith(`${HISTORY_ORIGIN}:`));
/** Adds a set to the project, newest run first; a workflow set up before (same origin) is not added again. */
export function applyHistorySet(s, set) {
  const taken = new Set((s.workflows || []).map(f => f.origin).filter(Boolean));
  const fresh = set.workflows.filter(f => !taken.has(f.origin)), ids = new Set(fresh.map(f => f.id));
  s.workflows = [...(s.workflows || []), ...fresh];
  s.workflowVersions = { ...(s.workflowVersions || {}), ...Object.fromEntries(fresh.map(f => [f.id, set.versions[f.id]])) };
  const runs = set.runs.filter(r => ids.has(r.flowId)).sort((a, b) => (b.number || 0) - (a.number || 0));
  s.workflowRuns = [...runs, ...(s.workflowRuns || [])];
  return { workflows: fresh.length, runs: runs.length };
}

// ---- display ---------------------------------------------------------------------

/** When a run happened, as the source recorded it: a date alone, a time, or not recorded. */
export function runWhen(r, { time = true } = {}) {
  if (!r?.at) return r?.imported ? 'Date not recorded' : '';
  const d = new Date(r.at); if (!Number.isFinite(d.getTime())) return '';
  // a documented date is that day wherever it is read (it is stored at noon UTC); every date reads as lib/dates.mjs writes it
  if (r.dateOnly) return day(String(r.at).slice(0, 10));
  return time ? when(d) : day(d);
}

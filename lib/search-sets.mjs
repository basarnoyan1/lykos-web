// Search sets (6 Nov 2026; plan §B, "Search sets"). A review that spans several conditions, populations or procedures can search each
// of them on its own: shared blocks, lines of a registered strategy (the Sham response review's A to E of PubMed strategy v3), joined
// by a template to one block per stratum, `(A) AND (B) AND (C) AND ({stratum}) NOT (D) NOT (E)`, so that each stratum is run and
// counted by itself. The same template without its stratum is the baseline: the registered search the strata are subsets of. A
// stratum's records the baseline lacks are its coverage gaps (records added between two runs, or a stratum block that is not a
// subset of the registered search). A set is registered (it is the review's search, reported as run) or supplementary (it checks
// the registered search; its gaps, once imported, are records identified by other methods in PRISMA 2020).
//
// s.searchSets: [{ id, name, database: 'pubmed', registered, strategy: { file, label, lines: [{ n, text, label }] } | null,
//   blocks: [{ key: 'A', label, line } | { key, label, text }], template, baseline?, baselineRuns: [run],
//   strata: [{ id, name, block, covers: [text], term: { vocabulary, code, label } | null, runs: [run] }] }]
// A run: { at, total, retrieved, pmids?, query?, queryHash, warnings?, error?, partial? }. The newest run of a stratum keeps its PMIDs
// and the query as run; an older one keeps its date, its count and the query's hash, so a project does not grow with every re-run.
import { parseStrategy } from './query-syntax.mjs';
import { checkQuery } from './query-check.mjs';
import { lib_bib_names$hash64 as hash64 } from "../boot.mjs";
import { meshState, meshPhrase } from './mesh-check.mjs';
import { lib_dates$longDay as longDay } from "../boot.mjs";

export const STRATUM = '{stratum}';
export const searchSets = s => (Array.isArray(s?.searchSets) ? s.searchSets : []);
export const setById = (s, id) => searchSets(s).find(x => x.id === id) || null;
const slug = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'set';
/** An id from a name that none of `taken` holds: "sham-response", then "sham-response-2". */
export function freeId(name, taken = [], prefix = '') {
  const base = `${prefix}${slug(name)}`, have = new Set(taken);
  if (!have.has(base)) return base;
  for (let i = 2; ; i++) if (!have.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ---- blocks and the template --------------------------------------------------------------------------------------------------

/** Line `n` of a numbered strategy with every #k it uses written out in brackets (lib/query-syntax.mjs), or null when there is none. */
export function lineText(lines, n) {
  const upto = (lines || []).filter(l => Number(l.n) <= Number(n));
  if (!upto.some(l => Number(l.n) === Number(n))) return null;
  return parseStrategy(JSON.stringify({ lines: upto.map(l => ({ n: Number(l.n), q: String(l.text ?? '') })) })).query;
}
export const blockOf = (set, key) => (set?.blocks || []).find(b => b.key === key) || null;
/** A shared block's text as it runs: its strategy line written out, or its own text. */
export function blockText(set, key) {
  const b = blockOf(set, key);
  if (!b) return null;
  return b.line != null ? lineText(set.strategy?.lines, b.line) : String(b.text ?? '');
}

const TOKEN = /\{stratum\}|#\d+|"[^"]*"(?:\[[^\]]*\])?|\[[^\]]*\]|[^\s()"[\]]+(?:\[[^\]]*\])?|\(|\)|\s+|./gi;
const OPERATOR = /^(AND|OR|NOT)$/i;
/**
 * A template with its blocks written out: block keys (A), strategy lines (#12) and `{stratum}` replaced by their text, each in
 * brackets unless the template already brackets it alone. A field-tagged word or a quoted phrase is kept as written (a limit typed
 * into the template). Answers { query, problems: [{ level: 'error', text }] }.
 */
export function expandTemplate(set, template, stratumBlock = null) {
  const toks = String(template ?? '').match(TOKEN) || [], problems = [], out = [];
  const near = (i, d) => { for (let k = i + d; k >= 0 && k < toks.length; k += d) if (!/^\s+$/.test(toks[k])) return toks[k]; return null; };
  toks.forEach((t, i) => {
    let text = null;
    if (/^\s+$/.test(t) || t === '(' || t === ')') { out.push(t); return; }
    if (OPERATOR.test(t)) { out.push(t.toUpperCase()); return; }
    if (t.toLowerCase() === STRATUM) {
      if (stratumBlock == null) { problems.push({ level: 'error', text: 'The stratum is not given here.' }); return; }
      text = String(stratumBlock).trim();
      if (!text) problems.push({ level: 'error', text: 'The stratum block is empty.' });
    } else if (/^#\d+$/.test(t)) {
      text = lineText(set?.strategy?.lines, Number(t.slice(1)));
      if (text == null) problems.push({ level: 'error', text: `${t} is not a line of ${set?.strategy?.label || 'the strategy'}.` });
    } else if (blockOf(set, t)) text = blockText(set, t);
    else if (/\[[^\]]*\]$/.test(t) || /^"/.test(t)) { out.push(t); return; }
    else { problems.push({ level: 'error', text: `${t} is not a block of this set: use ${(set?.blocks || []).map(b => b.key).join(', ') || 'a block key'} or {stratum}.` }); out.push(t); return; }
    if (text == null) return;
    out.push(near(i, -1) === '(' && near(i, 1) === ')' ? text : `(${text})`);
  });
  return { query: out.join('').replace(/\s+/g, ' ').trim(), problems };
}

/** The template's problems, worded for the set's page: no {stratum}, a key that is not a block, a #line the strategy lacks. */
export function templateProblems(set) {
  const t = String(set?.template ?? ''), n = (t.match(/\{stratum\}/gi) || []).length, out = [];
  if (!t.trim()) return [{ level: 'error', text: 'The template is empty.' }];
  if (!n) out.push({ level: 'error', text: 'The template has no {stratum}: write {stratum} where each stratum\'s block goes.' });
  if (n > 1) out.push({ level: 'warn', text: `The template uses {stratum} ${n} times.` });
  return [...out, ...expandTemplate(set, t, 'x').problems];
}
/** The search a stratum runs: { query, problems }, with lib/query-check.mjs's errors on the written-out query. */
export function stratumQuery(set, stratum) {
  const r = expandTemplate(set, set?.template, stratum?.block ?? '');
  if (!r.problems.length) for (const p of checkQuery(r.query, { source: set?.database || 'pubmed' })) if (p.level === 'error') r.problems.push(p);
  return r;
}
/** The baseline's template: the set's own, or its template without the stratum and the operator joining it; null when neither is. */
export function baselineTemplate(set) {
  if (set?.baseline && String(set.baseline).trim()) return String(set.baseline);
  const t = String(set?.template ?? '');
  const out = t.replace(/\s+(AND|OR)\s+\(\s*\{stratum\}\s*\)|\s+(AND|OR)\s+\{stratum\}/i, '').replace(/\(\s*\{stratum\}\s*\)\s+(AND|OR)\s+|\{stratum\}\s+(AND|OR)\s+/i, '');
  return out === t || /\{stratum\}/i.test(out) ? null : out;
}
/** The registered search the strata are compared with: { query, problems }, or null when the set has no baseline. */
export function baselineQuery(set) {
  const t = baselineTemplate(set);
  return t == null ? null : expandTemplate(set, t, null);
}

// ---- making a set -------------------------------------------------------------------------------------------------------------

/** A new set: { id, name, database, registered, strategy, blocks, template, strata: [], baselineRuns: [] }. */
export function newSet({ name, database = 'pubmed', registered = false, strategy = null, blocks = [], template = '', baseline = '' } = {}, taken = []) {
  return { id: freeId(name, taken), name: String(name || 'Search set').trim(), database, registered: !!registered, strategy, blocks, template: String(template || ''),
    ...(baseline ? { baseline } : {}), strata: [], baselineRuns: [] };
}
/** Adds a stratum to a set (in place) and answers it. */
export function addStratum(set, { name, block = '', covers = [], term = null } = {}) {
  const st = { id: freeId(name, (set.strata || []).map(x => x.id), 'st-'), name: String(name || 'Stratum').trim(), block: String(block || '').trim(),
    covers: (covers || []).map(String).filter(Boolean), term: term || null, runs: [] };
  (set.strata ||= []).push(st);
  return st;
}

/**
 * A set from a strategy file of strata, the form the Sham review wrote (PubMed strategy … indications v3 2026-11-06.json): `shared_lines`
 * [{ n, block, q }], `queries` [{ heading, grid_indications, indication, final, pubmed_count }], `date`, `version`, `database`. A shared
 * line whose block label starts with one letter ("A intracranial procedure") is that block; a line the final query uses without a
 * letter takes the next free one. The template is the first query's final line with its stratum replaced. A count the file gives is
 * a run of that date without PMIDs. Answers the set; throws when the file is not of this form.
 */
export function setFromStrategyFile(doc, { file = '', name = '', taken = [] } = {}) {
  const lines = (Array.isArray(doc?.shared_lines) ? doc.shared_lines : Array.isArray(doc?.lines) ? doc.lines : []).map(l => ({ n: Number(l.n), text: String(l.q ?? l.query ?? ''), label: String(l.block || '') }));
  const queries = Array.isArray(doc?.queries) ? doc.queries : Array.isArray(doc?.strata) ? doc.strata : [];
  if (!lines.length || !queries.length) throw new Error('Not a search set file: it needs shared lines and one query per stratum');
  const first = queries[0], final = String(first.final || ''), own = String(first.indication ?? first.block ?? '');
  // a file this module wrote (setToFile) gives its template and blocks; the Sham form gives a final line per stratum, whose stratum is
  // taken out: "(#12 AND #13 AND #14 AND (…)) NOT #15 NOT #16"
  let template = doc.template ? String(doc.template) : final && own && final.includes(own) ? final.replace(own, STRATUM).replace(/\(\s*\(\{stratum\}\)\s*\)/, '({stratum})') : '';
  if (!template) throw new Error('The file gives no template, and its first final line does not hold its stratum block: give the template');
  let blocks = Array.isArray(doc.blocks) && doc.blocks.length
    ? doc.blocks.map(b => (b.line != null ? { key: String(b.key), label: String(b.label || ''), line: Number(b.line) } : { key: String(b.key), label: String(b.label || ''), text: String(b.q ?? b.text ?? '') }))
    : null;
  if (!blocks) {
    const used = [...new Set([...template.matchAll(/#(\d+)/g)].map(m => Number(m[1])))], keys = new Set();
    blocks = [];
    for (const n of used) {
      const l = lines.find(x => x.n === n), m = /^([A-Z])\b[\s,:.-]*(.*)$/.exec(l?.label || '');
      if (m && !keys.has(m[1])) { keys.add(m[1]); blocks.push({ key: m[1], label: m[2].trim(), line: n }); }
    }
    for (const n of used) if (!blocks.some(b => b.line === n)) {
      const key = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(k => !keys.has(k)); keys.add(key);
      blocks.push({ key, label: (lines.find(x => x.n === n)?.label || '').trim(), line: n });
    }
    blocks.sort((a, b) => a.key.localeCompare(b.key));
    for (const b of blocks) template = template.replace(new RegExp(`#${b.line}(?!\\d)`, 'g'), b.key);
  }
  const version = String(doc.version || ''), db = String(doc.database || 'PubMed');
  const set = newSet({ name: name || String(doc.name || '').trim() || [db, version, 'strata'].filter(Boolean).join(' '), database: /pubmed/i.test(db) ? 'pubmed' : db.toLowerCase(),
    registered: !!doc.registered, strategy: { file, label: [db, version].filter(Boolean).join(' '), lines }, blocks, template }, taken);
  const at = String(doc.date || doc.checks?.date || '').slice(0, 10);
  for (const q of queries) {
    const st = addStratum(set, { name: q.heading || q.name, block: q.indication ?? q.block, covers: q.grid_indications || q.covers || [] });
    const n = q.pubmed_count ?? q.count;
    if (n != null && at) st.runs.push({ at, total: Number(n), retrieved: null, queryHash: hash64(stratumQuery(set, st).query), from: 'file' });
  }
  return set;
}

// ---- runs ---------------------------------------------------------------------------------------------------------------------

export const latestRun = x => (x?.runs || x?.baselineRuns || []).at(-1) || null;
/**
 * Adds a run to a stratum (or, with `baseline`, to the set's baseline), in place: { at, total, pmids, query, warnings, error }. The run
 * before it keeps its date, count and the hash of its query; its PMIDs and query text go.
 */
export function recordRun(target, { at, total = null, pmids = null, query = '', warnings = null, error = '' } = {}, { baseline = false } = {}) {
  const list = baseline ? (target.baselineRuns ||= []) : (target.runs ||= []);
  const prev = list.at(-1);
  if (prev) { delete prev.pmids; delete prev.query; }
  const ids = Array.isArray(pmids) ? [...new Set(pmids.map(String))] : null;
  const run = { at: String(at || new Date().toISOString()), total: total == null ? null : Number(total), retrieved: ids ? ids.length : null,
    ...(ids ? { pmids: ids } : {}), ...(query ? { query, queryHash: hash64(query) } : {}), ...(Array.isArray(warnings) && warnings.length ? { warnings } : {}),
    ...(error ? { error: String(error) } : {}), ...(ids && total != null && ids.length < Number(total) ? { partial: true } : {}) };
  list.push(run);
  return run;
}
/** Whether a stratum's newest run ran the query the set writes for it now (a block or template edited since shows "changed"). */
export const runIsCurrent = (set, st) => { const r = latestRun(st); return !!r && r.queryHash === hash64(expandTemplate(set, set?.template, st?.block ?? '').query); };

// ---- coverage -------------------------------------------------------------------------------------------------------------------

const pmidsOf = r => (Array.isArray(r?.pmids) ? r.pmids : null);
/**
 * Each stratum against the baseline: { baseline: { run, ids } | null, rows: [{ id, name, total, at, gaps: [pmid] | null, sameDay, partial }],
 * gapIds: every gap once, in stratum order }. Gaps are null until both a stratum and the baseline have been run with their PMIDs.
 */
export function coverage(set) {
  const b = latestRun({ runs: set?.baselineRuns }), base = pmidsOf(b), have = base ? new Set(base) : null;
  const rows = (set?.strata || []).map(st => {
    const r = latestRun(st), ids = pmidsOf(r);
    return { id: st.id, name: st.name, total: r?.total ?? null, at: r?.at || '', gaps: have && ids ? ids.filter(x => !have.has(x)) : null,
      sameDay: !!(r?.at && b?.at && r.at.slice(0, 10) === b.at.slice(0, 10)), partial: !!(r?.partial || b?.partial) };
  });
  return { baseline: b ? { run: b, ids: base } : null, rows, gapIds: [...new Set(rows.flatMap(r => r.gaps || []))] };
}
/** Records in each pair of strata: { ids: [stratum id], names, cells: [[n | null]] } (the diagonal is each stratum's own records), and `union`. */
export function overlap(set) {
  const strata = set?.strata || [], sets = strata.map(st => { const ids = pmidsOf(latestRun(st)); return ids ? new Set(ids) : null; });
  const cells = sets.map(a => sets.map(b => { if (!a || !b) return null; let n = 0; for (const x of a) if (b.has(x)) n++; return n; }));
  const all = new Set(); for (const x of sets) if (x) for (const id of x) all.add(id);
  return { ids: strata.map(s => s.id), names: strata.map(s => s.name), cells, union: sets.some(Boolean) ? all.size : null };
}
/** Gap PMIDs the library does not hold yet (by PMID), the ones an import would fetch. */
export function gapsToImport(set, papers = []) {
  const held = new Set((papers || []).map(p => String(p?.pmid || '')).filter(Boolean));
  return coverage(set).gapIds.filter(x => !held.has(x));
}
/** The source a gap import is logged under: an other method of PRISMA 2020 (lib/prisma-counts.mjs reads "Other sources …" as one). */
export const gapSource = set => `Other sources (search set ${set?.name || ''})`.replace(/\s+\)$/, ')');

// ---- a stratum's state on the page ----------------------------------------------------------------------------------------------

/** What each stratum's row shows: [{ stratum, total, at, current, error, gaps: n | null, sameDay, mesh: { terms, counts, at, phrase } }]. */
export function setRows(set, cache = {}) {
  const cov = new Map(coverage(set).rows.map(r => [r.id, r]));
  return (set?.strata || []).map(st => {
    const r = latestRun(st), c = cov.get(st.id), mesh = meshState(st.block, cache, { source: set?.database || 'pubmed' });
    return { stratum: st, total: r?.total ?? null, at: r?.at || '', current: runIsCurrent(set, st), error: r?.error || '', gaps: c?.gaps ? c.gaps.length : null,
      sameDay: !!c?.sameDay, mesh: { ...mesh, phrase: meshPhrase(mesh) } };
  });
}
/** Every MeSH heading of a set (its shared blocks and its strata), once each: what Check MeSH looks up. */
export function setHeadings(set) {
  const texts = [...(set?.blocks || []).map(b => blockText(set, b.key) || ''), ...(set?.strata || []).map(st => st.block)];
  return [...new Map(texts.flatMap(t => meshState(t, {}, { source: set?.database || 'pubmed' }).terms).map(t => [t.key, t.heading])).values()];
}

// ---- export ----------------------------------------------------------------------------------------------------------------------

const day = d => longDay(String(d || '').slice(0, 10)).replace(/^\S+\s/, '');   // "7 November 2026": the day searched, without its weekday
const fmt = n => (n == null ? '' : Number(n).toLocaleString('en-US'));
const DB_NAMES = { pubmed: 'PubMed' };
/**
 * The set as a PRISMA-S strategy document for lib/docx-write.mjs: blocks of runs ({ text, bold }), never markup. Items: the database
 * (PRISMA-S 1), each search exactly as run (8), the dates searched (13), the records each found (15), and the coverage against the
 * registered search with the overlap between strata.
 */
export function setDocument(set, { cache = {} } = {}) {
  const db = DB_NAMES[set.database] || set.database || 'PubMed', out = [];
  const p = (...runs) => out.push({ type: 'p', runs: runs.filter(Boolean).map(r => (typeof r === 'string' ? { text: r } : r)) });
  const head = (text, level = 1) => out.push({ type: 'p', styleId: `Heading${level}`, runs: [{ text, bold: true }] });
  const label = (text, rest) => p({ text: `${text}: `, bold: true }, { text: String(rest ?? '') });
  head(`${set.name}: search strategies`);
  p(`${db}. ${set.registered ? 'The registered search.' : 'A supplementary search, not the registered search: its strata check the registered search, and records it alone found are reported as identified by other methods.'}`);
  head('Shared blocks', 2);
  for (const b of set.blocks || []) label(`${b.key}${b.label ? `, ${b.label}` : ''}${b.line != null ? ` (line ${b.line} of ${set.strategy?.label || 'the strategy'})` : ''}`, blockText(set, b.key));
  label('Each stratum', set.template);
  const base = baselineQuery(set), br = latestRun({ runs: set.baselineRuns });
  if (base) label('Registered search', base.query);
  if (br) label(`${db}, ${day(br.at)}`, `${fmt(br.total)} records`);
  head('Strata', 2);
  for (const st of set.strata || []) {
    const r = latestRun(st), q = r?.query || stratumQuery(set, st).query, ms = meshState(st.block, cache, { source: set.database });
    head(st.name, 3);
    if (st.covers?.length) label('Covers', st.covers.join('; '));
    if (st.term?.label) label('Term', st.term.label);
    label('Stratum block', st.block);
    label(r?.query ? 'Search as run' : 'Search', q);
    label(r ? `${db}, ${day(r.at)}` : db, r ? `${fmt(r.total)} records${r.error ? ` (${r.error})` : ''}` : 'not run');
    if (ms.terms.length) label('MeSH', `${meshPhrase(ms)}${ms.at ? `, checked against NLM on ${day(ms.at)}` : ''}`);
  }
  const cov = coverage(set);
  if (cov.baseline) {
    head('Coverage against the registered search', 2);
    out.push({ type: 'table', header: true, rows: [['Stratum', 'Records', 'Not in the registered search', 'Searched'],
      ...cov.rows.map(r => [r.name, fmt(r.total), r.gaps ? fmt(r.gaps.length) : 'not run', day(r.at)])] });
    const ov = overlap(set), pairs = [];
    ov.cells.forEach((row, i) => row.forEach((n, j) => { if (j > i && n) pairs.push([ov.names[i], ov.names[j], fmt(n)]); }));
    if (ov.union != null) p(`${fmt(ov.union)} records in all strata together; ${pairs.length ? `${pairs.length} pairs of strata share records.` : 'no record is in two strata.'}`);
    if (pairs.length) out.push({ type: 'table', header: true, rows: [['Stratum', 'Stratum', 'Records in both'], ...pairs] });
  }
  return out;
}
/** The set as a strategy file of strata (the form setFromStrategyFile reads), for the folder. */
export function setToFile(set) {
  const lines = set.strategy?.lines || [];
  return { name: set.name, database: DB_NAMES[set.database] || set.database, registered: !!set.registered, template: set.template,
    shared_lines: lines.map(l => ({ n: l.n, block: l.label || '', q: l.text })),
    blocks: (set.blocks || []).map(b => ({ key: b.key, label: b.label || '', ...(b.line != null ? { line: b.line } : { q: b.text }) })),
    queries: (set.strata || []).map(st => ({ heading: st.name, grid_indications: st.covers || [], indication: st.block, final: stratumQuery(set, st).query,
      ...(latestRun(st)?.total != null ? { pubmed_count: latestRun(st).total, date: String(latestRun(st).at).slice(0, 10) } : {}) })) };
}

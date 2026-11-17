// Search Summary Table (Bethel, Rogers and Abbott 2021, J Med Libr Assoc):
// for each database or method in the search log, how many of the included
// studies it found, how many only it found (its unique yield), and its recall
// against the final inclusion list. It is computed from the search log and the
// final inclusion decisions, and it reports (PRISMA-S item on the search
// methods) what the search yielded, not whether the search was complete.
//
// The sources of a record are its `databases` (the imports and searches that
// found it, lib/search-library.mjs noteSource), plus those of any duplicate
// merged into it, so a study found by three databases and merged once still
// counts for all three.
import { lib_screen$isIncluded as isIncluded, lib_screen$screeningStarted as screeningStarted } from "../boot.mjs";
import { sourceName, flowArms, runName, identification, recordSources, sourceKind, isOtherMethod } from './prisma-counts.mjs';
import { database, databaseIn } from './databases.mjs';
import { ownRun } from './reviews.mjs';

export const NO_SOURCE = 'Source not recorded';
const rate = (n, d) => d ? n / d : null;
const fileBase = f => String(f || '').split(/[\\/]/).pop();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "8 Nov 2026" from a run's time or date, or ''. */
export const dayText = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };

/**
 * Every source a record counts under, folded as the PRISMA flow folds them (lib/prisma-counts.mjs flowArms): a run's own tag
 * ("WoS_PD_2026-11-08") is its database, and a tag only a retired run carries is no source. Merged duplicates included.
 * (16 Nov 2026, the owner on Sham's summary: "why use code name style things and why some say 0 retrieved": the raw tags were rows.)
 */
export function sourcesOf(s, paper, arms = flowArms(s)) {
  return arms.sourcesOf(paper);
}

/**
 * A run's topic and how it reads: `{ topic, label, short }`. The topic is what the run's name or file says besides its database, its
 * version, its date and "filtered" ("WoS_PD_2026-11-08" → "PD"); a name written as words ("CENTRAL v16, records restored after the filter
 * of 8 Nov") is kept as written. `label` is "Web of Science: PD, 8 Nov 2026", `short` the same without the database (a run's row sits
 * under its database).
 */
export function runReading(r, db = runName(r)) {
  const raw = String(r.name || '').trim() || fileBase(r.file).replace(/\.[a-z0-9]+$/i, '');
  const day = dayText(r.date || r.at);
  let topic = '';
  if (raw && /\s/.test(raw) && !raw.includes('_')) topic = raw === db ? '' : raw;
  else if (raw) {
    const dbOf = t => (database(t) || (t.length > 2 ? databaseIn(t) : null))?.name;
    topic = raw.split('_').filter(t => t && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !/^\d{8}$/.test(t) && !/^v\d+(?:\.\d+)*$/i.test(t) && !/^filtered$/i.test(t)
      && !(dbOf(t) && dbOf(t) === db)).join(' ').trim();
  }
  const short = [topic, day].filter(Boolean).join(', ') || db;
  return { topic, label: `${db}${short !== db ? `: ${short}` : ''}`, short };
}

/** Whether an included record came from this run: its own tag, its import file or the search run it came from. */
function fromRun(r, p) {
  const tags = new Set(recordSources(p)), f = fileBase(r.file);
  if (r.name && tags.has(r.name)) return true;
  if (r.source && tags.has(r.source) && sourceName(r.source) !== r.source) return true;   // the run is known by its own tag, not its database's name
  if (f && p.importFile && fileBase(p.importFile) === f) return true;
  return !!(r.at && p.searchRun === r.at);
}
/** Whether a record can name its run at all (a run logged under its database's name, with no file, cannot be told from the others). */
const attributable = r => !!(r.name || (r.source && sourceName(r.source) !== r.source) || r.file || r.at);

/**
 * The table. Rows are the databases, registers and methods the flow counts; under each, its runs (`runList`): each run's own records
 * retrieved, the included studies it found and its precision, the retired ones apart (`retired`), counted nowhere. A database's records
 * retrieved is the flow's identification count for it (its live runs' records added up), so the table and PRISMA agree.
 * `included` is the final inclusion list; `unattributed` the included studies whose source was never recorded.
 */
export function searchSummary(s) {
  const arms = flowArms(s), all = (s.searches || []).filter(r => ownRun(r) && r.status !== 'failed');
  const started = screeningStarted(s);
  const included = started ? (s.papers || []).filter(p => isIncluded(s, p.id)) : [];
  const ids = identification(s, arms), idRow = new Map(ids.rows.map(x => [x.name, x]));
  const rows = new Map();
  const row = (name, kind) => {
    if (!rows.has(name)) rows.set(name, { source: name, kind: kind || 'database', runs: 0, retrieved: 0, exploratory: true, found: 0, unique: 0, recall: null, precision: null, studies: [], runList: [], retired: [] });
    return rows.get(name);
  };
  const retiredOnly = [];
  for (const r of all) {
    const name = r.citationSearch ? r.source || 'Citation searching' : runName({ ...r, source: r.source || 'PubMed' });
    const kind = r.citationSearch ? 'method' : isOtherMethod(sourceKind(r)) ? 'method' : sourceKind(r);
    // a retired run, or one of the review's previous version (PRISMA 2020's updated review), is listed apart and counted nowhere
    if (r.retired || r.previousVersion) {
      const home = (database(r.database) || database(name) || databaseIn(name))?.name;
      const entry = { run: r, ...runReading(r, home || name), at: r.retired?.at || '', scenario: r.retired?.scenario || '', previous: !!r.previousVersion && !r.retired, retrieved: Number(r.retrieved) || 0 };
      (home ? row(home, kind).retired : retiredOnly).push(entry);
      continue;
    }
    const x = row(name, kind);
    x.runs++; x.retrieved += Number(r.retrieved) || 0;
    if (!r.exploratory) x.exploratory = false;
    x.runList.push({ run: r, ...runReading(r, name), retrieved: r.retrieved == null || r.retrieved === '' ? null : Number(r.retrieved), exploratory: !!r.exploratory, found: null, precision: null });
  }
  let attributed = 0;
  const unattributed = [], retiredFound = [];
  for (const p of included) {
    const names = sourcesOf(s, p, arms);
    // an included study only retired runs brought is found by no counted search (lib/prisma-counts.mjs: method 'retired')
    if (!names.length) { (arms.methodOf(p).method === 'retired' ? retiredFound : unattributed).push(p.id); continue; }
    attributed++;
    for (const n of names) {
      const x = row(n, /citation|reference|hand|expert|other/i.test(n) ? 'method' : 'database');
      x.found++; x.studies.push(p.id);
      if (names.length === 1) x.unique++;
    }
  }
  const dups = new Map();
  for (const m of s.merged || []) if (m.keepId && m.dup) dups.set(m.keepId, [...(dups.get(m.keepId) || []), m.dup]);
  const total = included.length;
  for (const x of rows.values()) {
    // a database the flow counts: PRISMA's identification count for it, so the two agree
    const id = idRow.get(x.source);
    if (id && x.runList.some(u => !u.exploratory)) { x.retrieved = id.count; x.rule = id.rule; }
    x.recall = rate(x.found, total);
    x.precision = x.retrieved ? rate(x.found, x.retrieved) : null;
    if (!x.runs) x.exploratory = false;
    // a run's own found and precision only where every included study its database found names the run it came from (a tag, its file or
    // its search run); otherwise the runs share studies the project cannot tell apart, and only their retrieved numbers are known
    const live = x.runList.filter(u => attributable(u.run)), held = live.length ? included.filter(p => x.studies.includes(p.id)) : [];
    const told = live.length === x.runList.length && held.every(p => live.some(u => fromRun(u.run, p) || (dups.get(p.id) || []).some(d => fromRun(u.run, d))));
    for (const u of x.runList) {
      if (!told) { u.why = 'the records do not say which of this database\'s runs found them'; continue; }
      u.found = included.filter(p => fromRun(u.run, p) || (dups.get(p.id) || []).some(d => fromRun(u.run, d))).length;
      u.precision = u.retrieved ? rate(u.found, u.retrieved) : null;
    }
    // two runs that would read alike say their version or filter
    const seen = new Map();
    for (const u of x.runList) seen.set(u.short, (seen.get(u.short) || 0) + 1);
    for (const u of x.runList) if (seen.get(u.short) > 1) { const v = [u.run.version || (/(?:^|_)(v\d+(?:\.\d+)*)(?:_|$)/i.exec(u.run.name || '') || [])[1], /filtered/i.test(u.run.name || u.run.file || '') ? 'filtered' : ''].filter(Boolean).join(', '); if (v) { u.short += ` (${v})`; u.label += ` (${v})`; } }
  }
  // a row with nothing live (only retired runs, no study) is no source of this search; its retired runs are listed apart
  for (const [k, x] of rows) if (!x.runs && !x.found) { retiredOnly.push(...x.retired); rows.delete(k); }
  const list = [...rows.values()].sort((a, b) => b.found - a.found || a.source.localeCompare(b.source));
  return { started, total, attributed, unattributed, retiredFound, rows: list, retired: retiredOnly,
    // a study found by any listed source; with every study attributed this is the total
    union: attributed, retrieved: list.filter(x => !x.exploratory).reduce((a, x) => a + x.retrieved, 0) };
}

const pct = v => v == null ? '' : `${(v * 100).toFixed(1)}%`;
export const HEAD = ['Database or method', 'Records retrieved', 'Included studies found', 'Found only here', 'Recall', 'Precision'];

/** Rows for a CSV, a Word table or Markdown, with the totals line. */
export function summaryRows(t) {
  const body = t.rows.map(x => [x.source + (x.exploratory ? ' (exploratory)' : ''), x.retrieved, x.found, x.unique, pct(x.recall), pct(x.precision)]);
  const foot = [['All sources', t.retrieved, t.union, '', t.total ? pct(t.union / t.total) : '', '']];
  return { head: HEAD, body, foot, unattributed: t.unattributed.length, retiredFound: (t.retiredFound || []).length, total: t.total };
}
/** What the table counts, for its footnote: the counting rule and what it leaves out (decided 16 Nov 2026). */
export const COUNTING = 'A database searched in several runs counts the records its runs retrieved, added up, as the PRISMA flow does; retired and exploratory runs are not counted.';
export const NOT_COUNTED = 'Not attributed to a counted search';

/** Why a run apart is not counted, for the CSV. */
export const notCounted = u => u.previous ? 'no (the previous version\'s search)' : `no (retired ${dayText(u.at)}${u.scenario ? `, scenario ${u.scenario}` : ''})`;

/** The CSV: each database's row, then each of its runs on a row of its own ("Run" column), retired runs marked and not counted. */
export const toCsvRows = t => {
  const r = summaryRows(t), head = [r.head[0], 'Run', ...r.head.slice(1), 'Counted'];
  const out = [head];
  t.rows.forEach((x, i) => {
    out.push([r.body[i][0], '', ...r.body[i].slice(1), x.exploratory ? 'no (exploratory)' : 'yes']);
    for (const u of x.runList || []) out.push([x.source, u.short, u.retrieved ?? '', u.found ?? '', '', '', '', pct(u.precision), u.exploratory ? 'no (exploratory)' : 'in the database\'s count']);
    for (const u of x.retired || []) out.push([x.source, u.short, u.retrieved, '', '', '', '', '', notCounted(u)]);
  });
  for (const u of t.retired || []) out.push([u.label, '', u.retrieved, '', '', '', '', '', notCounted(u)]);
  out.push([r.foot[0][0], '', ...r.foot[0].slice(1), '']);
  if (r.retiredFound) out.push([NOT_COUNTED, '', '', r.retiredFound, '', '', '', '', '']);
  if (r.unattributed) out.push([NO_SOURCE, '', '', r.unattributed, '', '', '', '', '']);
  out.push(['Included studies', '', '', r.total, '', '', '', '', '']);
  return out;
};

const leftOut = r => `${r.retiredFound ? `; ${r.retiredFound} ${NOT_COUNTED.toLowerCase()}` : ''}${r.unattributed ? `; ${r.unattributed} with no source recorded` : ''}`;

export function toMarkdown(t, title = '') {
  const r = summaryRows(t);
  const line = c => `| ${c.join(' | ')} |`;
  return [`# Search summary${title ? ` — ${title}` : ''}`, '',
    'Included studies found by each source, and by that source alone (after Bethel et al. 2021). Recall is the share of all included studies a source found; precision the share of its retrieved records that were included.', '',
    line(r.head), line(r.head.map(() => '---')), ...r.body.map(line), ...r.foot.map(line), '',
    `Included studies: ${r.total}${leftOut(r)}. ${COUNTING}`].join('\n');
}

/** Blocks for the Word writer: a heading, the table, and what it counts. */
export function toBlocks(t, title = '') {
  const r = summaryRows(t); let n = 0; const id = () => `t${++n}`;
  return [
    { id: id(), type: 'title', text: 'Supplementary appendix: search summary table' },
    { id: id(), type: 'p', text: `${title ? `${title}. ` : ''}Included studies found by each database or method, and found by that source alone (after Bethel et al. 2021).` },
    { id: id(), type: 'table', header: true, rows: [r.head, ...r.body, ...r.foot.map(f => f.map(String))].map(row => row.map(String)) },
    { id: id(), type: 'p', text: `Recall is the share of the ${r.total} included studies that a source found; precision is the share of its retrieved records that were included. ${COUNTING}${r.retiredFound ? ` ${r.retiredFound} included studies were found by no counted search.` : ''}${r.unattributed ? ` ${r.unattributed} included studies have no source recorded.` : ''}` },
  ];
}

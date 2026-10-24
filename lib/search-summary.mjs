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
import { isIncluded, screeningStarted } from './screen.mjs';
import { databasesOf } from './search-library.mjs';
import { sourceName } from './prisma-counts.mjs';
import { ownRun } from './reviews.mjs';

export const NO_SOURCE = 'Source not recorded';
const rate = (n, d) => d ? n / d : null;

/** Every source name that found a record, merged duplicates included. */
export function sourcesOf(s, paper) {
  const names = new Set(databasesOf(paper).map(sourceName));
  for (const m of s.merged || []) if (m.keepId === paper.id && m.dup) for (const d of databasesOf(m.dup)) names.add(sourceName(d));
  return [...names];
}

/**
 * The table. Rows are the sources of the search log and of the included
 * studies. `included` is the final inclusion list; `unattributed` the included
 * studies whose source was never recorded (they count in the total but in no
 * row, and are named on their own row so the columns add up).
 */
export function searchSummary(s) {
  const runs = (s.searches || []).filter(r => ownRun(r) && r.status !== 'failed');
  const started = screeningStarted(s);
  const included = started ? (s.papers || []).filter(p => isIncluded(s, p.id)) : [];
  const rows = new Map();
  const row = (name, kind) => { if (!rows.has(name)) rows.set(name, { source: name, kind: kind || 'database', runs: 0, retrieved: 0, exploratory: true, found: 0, unique: 0, recall: null, precision: null, studies: [] }); return rows.get(name); };
  for (const r of runs) {
    const name = r.citationSearch ? r.source || 'Citation searching' : sourceName(r.source || 'PubMed');
    const x = row(name, r.citationSearch ? 'method' : r.kind);
    x.runs++; x.retrieved += Number(r.retrieved) || 0;
    if (!r.exploratory) x.exploratory = false;
  }
  let attributed = 0;
  const unattributed = [];
  for (const p of included) {
    const names = sourcesOf(s, p);
    if (!names.length) { unattributed.push(p.id); continue; }
    attributed++;
    for (const n of names) {
      const x = row(n, /citation|reference|hand|expert|other/i.test(n) ? 'method' : 'database');
      x.found++; x.studies.push(p.id);
      if (names.length === 1) x.unique++;
    }
  }
  const total = included.length;
  for (const x of rows.values()) {
    x.recall = rate(x.found, total);
    x.precision = x.retrieved ? rate(x.found, x.retrieved) : null;
    if (!x.runs) x.exploratory = false;
  }
  const list = [...rows.values()].sort((a, b) => b.found - a.found || a.source.localeCompare(b.source));
  return { started, total, attributed, unattributed, rows: list,
    // a study found by any listed source; with every study attributed this is the total
    union: attributed, retrieved: list.reduce((a, x) => a + x.retrieved, 0) };
}

const pct = v => v == null ? '' : `${(v * 100).toFixed(1)}%`;
export const HEAD = ['Database or method', 'Records retrieved', 'Included studies found', 'Found only here', 'Recall', 'Precision'];

/** Rows for a CSV, a Word table or Markdown, with the totals line. */
export function summaryRows(t) {
  const body = t.rows.map(x => [x.source + (x.exploratory ? ' (exploratory)' : ''), x.retrieved, x.found, x.unique, pct(x.recall), pct(x.precision)]);
  const foot = [['All sources', t.retrieved, t.union, '', t.total ? pct(t.union / t.total) : '', '']];
  return { head: HEAD, body, foot, unattributed: t.unattributed.length, total: t.total };
}

export const toCsvRows = t => { const r = summaryRows(t); return [r.head, ...r.body, ...r.foot, ...(r.unattributed ? [[NO_SOURCE, '', r.unattributed, '', '', '']] : []), ['Included studies', '', r.total, '', '', '']]; };

export function toMarkdown(t, title = '') {
  const r = summaryRows(t);
  const line = c => `| ${c.join(' | ')} |`;
  return [`# Search summary${title ? ` — ${title}` : ''}`, '',
    'Included studies found by each source, and by that source alone (after Bethel et al. 2021). Recall is the share of all included studies a source found; precision the share of its retrieved records that were included.', '',
    line(r.head), line(r.head.map(() => '---')), ...r.body.map(line), ...r.foot.map(line), '',
    `Included studies: ${r.total}${r.unattributed ? `; ${r.unattributed} with no source recorded` : ''}.`].join('\n');
}

/** Blocks for the Word writer: a heading, the table, and what it counts. */
export function toBlocks(t, title = '') {
  const r = summaryRows(t); let n = 0; const id = () => `t${++n}`;
  return [
    { id: id(), type: 'title', text: 'Supplementary appendix: search summary table' },
    { id: id(), type: 'p', text: `${title ? `${title}. ` : ''}Included studies found by each database or method, and found by that source alone (after Bethel et al. 2021).` },
    { id: id(), type: 'table', header: true, rows: [r.head, ...r.body, ...r.foot.map(f => f.map(String))].map(row => row.map(String)) },
    { id: id(), type: 'p', text: `Recall is the share of the ${r.total} included studies that a source found; precision is the share of its retrieved records that were included.${r.unattributed ? ` ${r.unattributed} included studies have no source recorded.` : ''}` },
  ];
}

// Reading the coded corpus back (lib/qual.mjs): retrieval by code, document,
// case, attribute, coder and exemplar; code frequencies and co-occurrence;
// code × attribute cross-tabulation with a test of independence; the
// framework matrix; a mixed-methods joint display; intercoder agreement; the
// themes table; and the exchange of one coder's codings with another's.
//
// Pure: everything takes the state and returns data.
import { readQual, qualOf, pathOf, caseOfCoding, codesOfTheme, memoOf, ensureCode, addCoding, setParent, descendants } from './qual.mjs';
import { paragraphs, parseTurns, turnAt, timestamps } from './qual-text.mjs';
import { levelsOf } from './qual-cases.mjs';
import { chiSquareTest, fisherExact } from './stats-tables.mjs';
import { hashText } from './manuscript.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byId = list => new Map(list.map(x => [x.id, x]));

// ---- locators ---------------------------------------------------------------
/** Where a coding sits: '¶ 4 · Anna · 00:12:34', from the paragraph, the speaker turn and the last timestamp before it. */
export function locatorOf(doc, x, cache = new Map()) {
  if (!cache.has(doc.id)) cache.set(doc.id, { paras: paragraphs(doc.text), turns: parseTurns(doc.text), times: timestamps(doc.text) });
  const { paras, turns, times } = cache.get(doc.id);
  const p = paras.findIndex(r => x.start >= r.start && x.start <= r.end), t = turnAt(turns, x.start);
  const time = [...times].reverse().find(m => m.start <= x.start);
  return [p >= 0 ? `¶ ${p + 1}` : '', t?.speaker || '', (t?.time || time?.time) || ''].filter(Boolean).join(', ');
}

// ---- retrieval --------------------------------------------------------------
/**
 * Coded segments matching every filter given:
 *   codeIds (with children unless includeChildren is false), docIds, caseIds,
 *   where: { attrId, value } on the coding's case, coder, exemplar (true: only exemplars).
 * One row per coding and matching code, ordered by code path, document, position.
 */
export function retrieve(s, { codeIds = null, includeChildren = true, docIds = null, caseIds = null, where = null, coder = null, exemplar = false } = {}) {
  const q = readQual(s), docs = byId(q.documents), cases = byId(q.cases), codes = byId(q.codes);
  const wanted = codeIds?.length ? new Set(codeIds.flatMap(id => (includeChildren ? [id, ...descendants(s, id)] : [id]))) : null;
  const turnCache = new Map(), locCache = new Map(), rows = [];
  for (const x of q.codings) {
    const d = docs.get(x.docId); if (!d) continue;
    if (docIds?.length && !docIds.includes(x.docId)) continue;
    if (coder != null && coder !== '' && (x.coder || '') !== coder) continue;
    if (exemplar && !x.exemplar) continue;
    const caseId = caseOfCoding(s, x, turnCache), c = cases.get(caseId);
    if (caseIds?.length && !caseIds.includes(caseId)) continue;
    if (where?.attrId) { const v = c?.attributes?.[where.attrId]; if (v == null || String(v) !== String(where.value)) continue; }
    for (const codeId of x.codeIds) {
      if (wanted && !wanted.has(codeId)) continue;
      const code = codes.get(codeId); if (!code) continue;
      rows.push({ codingId: x.id, codeId, code: code.label, path: pathOf(s, codeId), docId: d.id, document: d.name, caseId, case: c?.label || '',
        locator: locatorOf(d, x, locCache), start: x.start, end: x.end, text: d.text.slice(x.start, x.end),
        memo: memoOf(s, 'coding', x.id), coder: x.coder || '', at: x.at, exemplar: !!x.exemplar, weight: x.weight ?? null });
    }
  }
  const order = new Map(q.documents.map((d, i) => [d.id, i]));
  return rows.sort((a, b) => a.path.localeCompare(b.path) || order.get(a.docId) - order.get(b.docId) || a.start - b.start);
}

export function retrievalCsvRows(rows) {
  return [['code_path', 'document', 'case', 'locator', 'segment', 'coder', 'exemplar', 'weight', 'memo'],
    ...rows.map(r => [r.path, r.document, r.case, r.locator, r.text, r.coder, r.exemplar ? 'yes' : '', r.weight ?? '', r.memo])];
}
const mdCell = t => String(t ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
/** The report as Markdown: a heading per code with its count, each segment quoted with its source. */
export function retrievalMarkdown(rows, { title = 'Coding retrieval' } = {}) {
  const out = [`# ${title}`, ''];
  for (const [path, list] of groupBy(rows, r => r.path)) {
    out.push(`## ${path} (${plural(list.length, 'segment')})`, '');
    for (const r of list) {
      out.push(`> ${mdCell(r.text)}`, `>`, `> — ${[r.document, r.case, r.locator, r.coder && `coder ${r.coder}`, r.exemplar && 'exemplar'].filter(Boolean).join(', ')}`, '');
      if (r.memo) out.push(`Memo: ${mdCell(r.memo)}`, '');
    }
  }
  return out.join('\n');
}
/** The report for the Word writer (docx-write.mjs writeTablesDocx): a heading per code, then its segments. */
export function retrievalDocxBlocks(rows, { title = 'Coding retrieval' } = {}) {
  const out = [{ type: 'para', text: title, bold: true, size: 12, after: 8 }];
  for (const [path, list] of groupBy(rows, r => r.path)) {
    out.push({ type: 'para', text: `${path} (${plural(list.length, 'segment')})`, bold: true, size: 10, before: 10, after: 4 });
    for (const r of list) {
      out.push({ type: 'para', text: `“${r.text}”`, size: 10, before: 4 });
      out.push({ type: 'para', text: `— ${[r.document, r.case, r.locator, r.coder && `coder ${r.coder}`, r.exemplar && 'exemplar'].filter(Boolean).join(', ')}`, size: 8, after: 2 });
      if (r.memo) out.push({ type: 'para', text: `Memo: ${r.memo}`, size: 8, after: 2 });
    }
  }
  return out;
}
function groupBy(list, f) { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

// ---- frequencies and co-occurrence -------------------------------------------
/** Per code: codings, documents, cases and characters coded (its own codings, and with its children). */
export function frequencies(s) {
  const q = readQual(s), turnCache = new Map();
  const caseOf = new Map(q.codings.map(x => [x.id, caseOfCoding(s, x, turnCache)]));
  const count = ids => {
    const set = new Set(ids), xs = q.codings.filter(x => x.codeIds.some(id => set.has(id)));
    return { codings: xs.length, documents: new Set(xs.map(x => x.docId)).size, cases: new Set(xs.map(x => caseOf.get(x.id)).filter(Boolean)).size, characters: xs.reduce((n, x) => n + x.end - x.start, 0) };
  };
  return q.codes.map(c => ({ codeId: c.id, label: c.label, path: pathOf(s, c.id), own: count([c.id]), all: count([c.id, ...descendants(s, c.id)]) }));
}

/**
 * Co-occurrence between codes: how many times a coding of one overlaps a
 * coding of the other in the same document (a coding carrying both counts
 * once). { codes, cells[i][j] } with the diagonal the code's own codings.
 */
export function cooccurrence(s, codeIds = null) {
  const q = readQual(s), ids = codeIds || q.codes.map(c => c.id), idx = new Map(ids.map((id, i) => [id, i]));
  const cells = ids.map(() => ids.map(() => 0));
  const xs = q.codings.filter(x => x.codeIds.some(id => idx.has(id)));
  for (const x of xs) for (const a of x.codeIds) if (idx.has(a)) cells[idx.get(a)][idx.get(a)]++;
  // each unordered pair of codes counted once per pair of overlapping (or shared) codings
  for (let i = 0; i < xs.length; i++) for (let j = i; j < xs.length; j++) {
    const x = xs[i], y = xs[j];
    if (x.docId !== y.docId || x.start >= y.end || y.start >= x.end) continue;
    const pairs = new Set();
    for (const a of x.codeIds) for (const b of y.codeIds) {
      if (a === b || !idx.has(a) || !idx.has(b)) continue;
      if (i === j && a > b) continue;
      const k = idx.get(a) < idx.get(b) ? `${a}|${b}` : `${b}|${a}`;
      if (!pairs.has(k)) pairs.add(k);
    }
    for (const k of pairs) { const [a, b] = k.split('|'); cells[idx.get(a)][idx.get(b)]++; cells[idx.get(b)][idx.get(a)]++; }
  }
  return { codes: ids.map(id => q.codes.find(c => c.id === id)).filter(Boolean), cells };
}
export function cooccurrenceCsvRows(m) {
  return [['code', ...m.codes.map(c => c.label)], ...m.codes.map((c, i) => [c.label, ...m.cells[i]])];
}

// ---- code × attribute --------------------------------------------------------
/**
 * Cases with each code (or any code beneath it) by the levels of an attribute.
 * { levels, n: cases per level, rows: [{ codeId, label, counts, pct, test }] }.
 * Each code is tested on its own 2 × levels table (coded, not coded): Fisher's
 * exact test for a 2 × 2 table, or when a chi-square has more than a fifth of
 * its expected counts below 5; otherwise Pearson's chi-square.
 */
export function crosstab(s, { codeIds, attrId, includeUnknown = false }) {
  const q = readQual(s), attr = q.attributes.find(a => a.id === attrId);
  if (!attr) return null;
  const levels = levelsOf(s, attrId), turnCache = new Map();
  if (includeUnknown) levels.push('Unknown');
  const levelOf = c => { const v = c.attributes?.[attrId]; return v == null ? (includeUnknown ? 'Unknown' : null) : String(v); };
  const cases = q.cases.filter(c => levelOf(c) != null);
  const n = levels.map(l => cases.filter(c => levelOf(c) === l).length);
  const casesWith = ids => { const set = new Set(ids), out = new Set(); for (const x of q.codings) if (x.codeIds.some(id => set.has(id))) { const c = caseOfCoding(s, x, turnCache); if (c) out.add(c); } return out; };
  const rows = (codeIds || q.codes.filter(c => !c.parent).map(c => c.id)).map(id => {
    const code = q.codes.find(c => c.id === id); if (!code) return null;
    const have = casesWith([id, ...descendants(s, id)]);
    const counts = levels.map(l => cases.filter(c => levelOf(c) === l && have.has(c.id)).length);
    const pct = counts.map((k, i) => (n[i] ? (100 * k) / n[i] : null));
    return { codeId: id, label: code.label, path: pathOf(s, id), counts, pct, test: testOf([counts, counts.map((k, i) => n[i] - k)]) };
  }).filter(Boolean);
  return { attribute: attr, levels, n, rows };
}
function testOf(table) {
  const keep = table[0].map((_, j) => table[0][j] + table[1][j] > 0);
  const t = table.map(r => r.filter((_, j) => keep[j]));
  if (t[0].length < 2 || t.every(r => r.every(v => v === 0)) || t.some(r => r.every(v => v === 0))) return { method: 'Not tested', p: null, note: 'A row or column has no cases' };
  const exact = () => { const f = fisherExact(t); return { method: "Fisher's exact test", p: f?.p ?? null, note: f?.message || '' }; };
  if (t[0].length === 2) return exact();
  const c = chiSquareTest(t, { correct: false });
  if (!c) return { method: 'Not tested', p: null, note: '' };
  if (c.smallExpected > 0.2) { const f = exact(); if (f.p != null) return { ...f, note: 'Chi-square expected counts too small' }; }
  return { method: "Pearson's chi-square", p: c.p, statistic: c.statistic, df: c.df, note: c.warnings.join(' ') };
}
export const fmtP = p => (p == null ? '' : p < 0.001 ? '< 0.001' : p.toFixed(3));
export function crosstabCsvRows(t) {
  return [['code', ...t.levels.map((l, i) => `${l} (n = ${t.n[i]})`), 'test', 'p'],
    ...t.rows.map(r => [r.path, ...r.counts.map((k, i) => `${k} (${r.pct[i] == null ? '–' : Math.round(r.pct[i])}%)`), r.test.method, fmtP(r.test.p)])];
}
export const crosstabMethod = t => `Cases with each code by ${t.attribute.label}; each code tested on its coded × not coded by level table (Fisher's exact test for 2 × 2 or sparse tables, otherwise Pearson's chi-square without continuity correction). Cases without a value are ${t.levels.includes('Unknown') ? 'a level of their own' : 'left out'}.`;

// ---- the framework matrix -----------------------------------------------------
/** A framework column: a code (with its children) or a theme. */
export function columnCodes(s, colId) {
  const q = readQual(s);
  const level = q.codes.some(c => c.id === colId) ? 'code' : q.descriptive.some(t => t.id === colId) ? 'descriptive' : q.analytical.some(t => t.id === colId) ? 'analytical' : null;
  return level ? codesOfTheme(s, level, colId) : [];
}
/**
 * Rows (cases, or documents when there are no cases) × columns (codes or
 * themes): the summary typed in each cell and the coded segments behind it.
 */
export function frameworkTable(s, columns) {
  const q = readQual(s), useCases = q.cases.length > 0, turnCache = new Map();
  const rows = useCases ? q.cases.map(c => ({ id: c.id, label: c.label })) : q.documents.map(d => ({ id: d.id, label: d.name }));
  const labelOfCol = id => q.codes.find(c => c.id === id)?.label || q.descriptive.find(t => t.id === id)?.label || q.analytical.find(t => t.id === id)?.label || '';
  const cols = columns.map(id => ({ id, label: labelOfCol(id), codes: new Set(columnCodes(s, id)) })).filter(c => c.label);
  const rowOf = x => (useCases ? caseOfCoding(s, x, turnCache) : x.docId);
  const segments = rows.map(r => cols.map(c => q.codings.filter(x => rowOf(x) === r.id && x.codeIds.some(id => c.codes.has(id)))));
  return { byCase: useCases, rows, cols: cols.map(({ id, label }) => ({ id, label })), segments, cells: rows.map(r => cols.map(c => q.framework.cells[`${r.id}|${c.id}`] || '')) };
}
export function setFrameworkCell(s, rowId, colId, text) {
  const cells = qualOf(s).framework.cells, k = `${rowId}|${colId}`;
  if (String(text ?? '').trim()) cells[k] = String(text); else delete cells[k];
}
export function frameworkCsvRows(f) {
  return [[f.byCase ? 'case' : 'document', ...f.cols.map(c => c.label)], ...f.rows.map((r, i) => [r.label, ...f.cells[i]])];
}

// ---- mixed-methods joint display ------------------------------------------------
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => (xs.length < 2 ? null : Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1)));
const summary = xs => (xs.length ? { n: xs.length, mean: mean(xs), sd: sd(xs) } : { n: 0, mean: null, sd: null });
export const fmtMeanSd = m => (m.mean == null ? '' : `${m.mean.toFixed(1)}${m.sd == null ? '' : ` (${m.sd.toFixed(1)})`}`);

/**
 * Codes or themes × groups of a dataset: per group, the numeric summary of a
 * column over all its rows; per row and group, the cases with the code, the
 * summary among them and an exemplar segment (one marked exemplar, else the
 * first). Dataset rows are joined to cases by the key column and case label.
 */
export function jointDisplay(s, { dataset, keyColumn, groupColumn, valueColumn, columns }) {
  const q = readQual(s), turnCache = new Map(), docs = byId(q.documents);
  const caseByLabel = new Map(q.cases.map(c => [c.label.trim().toLowerCase(), c.id]));
  const rowsIn = dataset.rows.map(r => ({ caseId: caseByLabel.get(String(r[keyColumn] ?? '').trim().toLowerCase()) || null, group: String(r[groupColumn] ?? '').trim() || 'Missing', value: Number.isFinite(Number(r[valueColumn])) && String(r[valueColumn]).trim() !== '' ? Number(r[valueColumn]) : null }));
  const groups = [...new Set(rowsIn.map(r => r.group))].sort();
  const valueOf = new Map(rowsIn.filter(r => r.caseId).map(r => [r.caseId, r]));
  const head = groups.map(g => { const rs = rowsIn.filter(r => r.group === g); return { group: g, rows: rs.length, cases: rs.filter(r => r.caseId).length, stat: summary(rs.map(r => r.value).filter(v => v != null)) }; });
  const labelOfCol = id => q.codes.find(c => c.id === id)?.label || q.descriptive.find(t => t.id === id)?.label || q.analytical.find(t => t.id === id)?.label || '';
  const rows = columns.map(id => {
    const codes = new Set(columnCodes(s, id));
    const xs = q.codings.filter(x => x.codeIds.some(k => codes.has(k))).map(x => ({ x, caseId: caseOfCoding(s, x, turnCache) })).filter(r => r.caseId && valueOf.has(r.caseId));
    const cells = groups.map((g, gi) => {
      const mine = xs.filter(r => valueOf.get(r.caseId).group === g), caseIds = [...new Set(mine.map(r => r.caseId))];
      const ex = mine.find(r => r.x.exemplar) || mine[0];
      return { cases: caseIds.length, of: head[gi].cases, stat: summary(caseIds.map(c => valueOf.get(c).value).filter(v => v != null)),
        exemplar: ex ? { text: docs.get(ex.x.docId).text.slice(ex.x.start, ex.x.end), source: [docs.get(ex.x.docId).name, q.cases.find(c => c.id === ex.caseId)?.label].filter(Boolean).join(', ') } : null };
    });
    return { id, label: labelOfCol(id), cells };
  }).filter(r => r.label);
  return { groups: head, rows, value: dataset.columns.find(c => c.id === valueColumn)?.label || valueColumn, group: dataset.columns.find(c => c.id === groupColumn)?.label || groupColumn };
}
export function jointCsvRows(j) {
  return [['theme', ...j.groups.map(g => `${j.group}: ${g.group} (cases ${g.cases}; ${j.value} ${fmtMeanSd(g.stat)})`)],
    ...j.rows.map(r => [r.label, ...r.cells.map(c => (c.of ? `${c.cases}/${c.of} cases; ${j.value} ${fmtMeanSd(c.stat) || '–'}${c.exemplar ? `; “${c.exemplar.text}” (${c.exemplar.source})` : ''}` : 'no coded data'))])];
}

// ---- intercoder agreement ------------------------------------------------------
/** Kappa from a 2 × 2 table [[both, A only], [B only, neither]]: { n, po, pe, kappa } (kappa null when pe = 1). */
export function kappaOf([[a, b], [c, d]]) {
  const n = a + b + c + d;
  if (!n) return { n: 0, po: null, pe: null, kappa: null };
  const po = (a + d) / n, pA = (a + b) / n, pB = (a + c) / n, pe = pA * pB + (1 - pA) * (1 - pB);
  return { n, po, pe, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}
const covered = (xs, len) => { const v = new Uint8Array(len); for (const x of xs) v.fill(1, Math.max(0, x.start), Math.min(len, x.end)); return v; };

/**
 * Agreement between two coders, per code: character units (each character
 * coded or not by each coder) or segment units (the pieces between every
 * boundary either coder drew). Only documents both coders coded count;
 * documents one coder coded alone are counted and left out.
 * Returns { docs, excluded, rows: [{ codeId, label, table, po, pe, kappa, n }], overall }.
 */
export function agreement(s, { coderA, coderB, unit = 'characters', codeIds = null }) {
  const q = readQual(s);
  const by = w => q.codings.filter(x => (x.coder || '') === w);
  const docsA = new Set(by(coderA).map(x => x.docId)), docsB = new Set(by(coderB).map(x => x.docId));
  const docs = q.documents.filter(d => docsA.has(d.id) && docsB.has(d.id));
  const excluded = q.documents.filter(d => docsA.has(d.id) !== docsB.has(d.id)).length;
  const ids = codeIds || q.codes.map(c => c.id);
  const total = [[0, 0], [0, 0]];
  const rows = ids.map(id => {
    const table = [[0, 0], [0, 0]];
    for (const d of docs) {
      const xa = q.codings.filter(x => x.docId === d.id && (x.coder || '') === coderA && x.codeIds.includes(id));
      const xb = q.codings.filter(x => x.docId === d.id && (x.coder || '') === coderB && x.codeIds.includes(id));
      const va = covered(xa, d.text.length), vb = covered(xb, d.text.length);
      if (unit === 'segments') {
        const cuts = [...new Set([0, d.text.length, ...[...xa, ...xb].flatMap(x => [x.start, x.end])])].sort((m, n) => m - n);
        for (let i = 0; i < cuts.length - 1; i++) { if (cuts[i + 1] <= cuts[i]) continue; const p = cuts[i]; table[va[p] ? 0 : 1][vb[p] ? 0 : 1]++; }
      } else for (let i = 0; i < d.text.length; i++) table[va[i] ? 0 : 1][vb[i] ? 0 : 1]++;
    }
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) total[r][c] += table[r][c];
    return { codeId: id, label: q.codes.find(c => c.id === id)?.label || id, path: pathOf(s, id), table, ...kappaOf(table) };
  });
  return { docs: docs.length, excluded, unit, rows, overall: { table: total, ...kappaOf(total) } };
}
export const agreementMethod = r => `Percent agreement and Cohen's kappa per code on ${r.unit === 'segments' ? 'segment units (the pieces between every boundary either coder drew)' : 'character units (each character coded or not by each coder)'}, over ${plural(r.docs, 'document')} coded by both coders${r.excluded ? `; ${plural(r.excluded, 'document')} coded by one coder left out` : ''}. The overall row pools the units of every code.`;
export function agreementCsvRows(r, a, b) {
  return [['code', `both`, `${a} only`, `${b} only`, 'neither', 'percent_agreement', 'kappa'],
    ...[...r.rows, { path: 'All codes (pooled)', ...r.overall }].map(x => [x.path, x.table[0][0], x.table[0][1], x.table[1][0], x.table[1][1], x.po == null ? '' : (100 * x.po).toFixed(1), x.kappa == null ? '' : x.kappa.toFixed(3)])];
}

// ---- themes ------------------------------------------------------------------------
/**
 * The themes table: each analytical theme, then each descriptive theme, with
 * its codes, the documents and cases behind it and up to two exemplar
 * segments (marked exemplars first). Without themes, the top-level codes of
 * the tree stand as themes.
 */
export function themesTable(s, { exemplars = 2 } = {}) {
  const q = readQual(s), docs = byId(q.documents), cases = byId(q.cases), turnCache = new Map();
  const list = [...q.analytical.map(t => ({ level: 'analytical', t })), ...q.descriptive.map(t => ({ level: 'descriptive', t }))];
  const items = list.length ? list : q.codes.filter(c => !c.parent).map(c => ({ level: 'code', t: c }));
  return items.map(({ level, t }) => {
    const ids = new Set(codesOfTheme(s, level, t.id));
    const xs = q.codings.filter(x => x.codeIds.some(k => ids.has(k)));
    const pick = [...xs.filter(x => x.exemplar), ...xs.filter(x => !x.exemplar)].slice(0, exemplars);
    const members = level === 'analytical' ? t.themes.map(d => q.descriptive.find(x => x.id === d)?.label).filter(Boolean)
      : level === 'descriptive' ? t.codes.map(c => q.codes.find(x => x.id === c)?.label).filter(Boolean)
      : q.codes.filter(c => c.parent === t.id).map(c => c.label);
    return { id: t.id, level, label: t.label, statement: t.statement || (level === 'code' ? t.description || '' : ''), members,
      documents: new Set(xs.map(x => x.docId)).size, cases: new Set(xs.map(x => caseOfCoding(s, x, turnCache)).filter(Boolean)).size,
      quotes: pick.map(x => { const c = cases.get(caseOfCoding(s, x, turnCache)); return { text: docs.get(x.docId)?.text.slice(x.start, x.end) || '', source: c?.label || docs.get(x.docId)?.name || '' }; }) };
  });
}
const quoteLine = r => r.quotes.map(x => `“${x.text}” (${x.source})`).join(' ');
export function themesCsvRows(rows) {
  return [['level', 'theme', 'statement', 'members', 'documents', 'cases', 'exemplar_quotes'],
    ...rows.map(r => [r.level, r.label, r.statement, r.members.join('; '), r.documents, r.cases, quoteLine(r)])];
}
/** The themes table as manuscript blocks: a numbered caption and an APA-ruled table. */
export function themesManuscriptBlocks(rows, newId, { title = 'Themes with exemplar quotes' } = {}) {
  const text = `Table {{seq:Table}}. ${title}`;
  const grid = [['Theme', 'Codes', 'Exemplar quotes'], ...rows.map(r => [r.statement ? `${r.label}: ${r.statement}` : r.label, r.members.join('; '), quoteLine(r)])];
  const cell = t => ({ runs: [{ t: String(t ?? '') }], text: String(t ?? '') });
  return [
    { id: newId(), type: 'p', styleId: 'Caption', runs: [{ t: text }], text },
    { id: newId(), type: 'table', text: '', grid: { cols: [140, 110, 218], borders: 'apa', rows: grid.map((r, i) => ({ header: i === 0, cells: r.map(cell) })) } },
  ];
}
export function themesDocxBlocks(rows, { title = 'Themes with exemplar quotes' } = {}) {
  return [{ type: 'para', text: title, bold: true, size: 10, after: 6 },
    { type: 'table', widths: [3600, 3000, 8600], header: ['Theme', 'Codes', 'Exemplar quotes'], headerFill: 'F2F2F2',
      rows: rows.map(r => ({ cells: [r.statement ? `${r.label}: ${r.statement}` : r.label, r.members.join('; '), quoteLine(r)].map(text => ({ text, span: 1 })) })) }];
}

// ---- one coder's codings, exported and imported ------------------------------------------
export const CODINGS_FORMAT = 'lykos-qual-codings';
/** A coder's codings (all coders when `coder` is null) with the documents and codes they refer to. */
export function exportCodings(s, coder = null) {
  const q = readQual(s), xs = q.codings.filter(x => coder == null || (x.coder || '') === coder);
  const used = new Set(xs.flatMap(x => x.codeIds)), docIds = new Set(xs.map(x => x.docId));
  return { format: CODINGS_FORMAT, version: 1, exportedAt: new Date().toISOString(), coder,
    documents: q.documents.filter(d => docIds.has(d.id)).map(d => ({ id: d.id, name: d.name, length: d.text.length, hash: hashText(d.text) })),
    codes: q.codes.filter(c => used.has(c.id)).map(c => ({ id: c.id, label: c.label, path: pathOf(s, c.id).split(' › ') })),
    codings: xs.map(x => ({ docId: x.docId, start: x.start, end: x.end, codeIds: x.codeIds, coder: x.coder || '', at: x.at, exemplar: !!x.exemplar, weight: x.weight ?? null })) };
}

/**
 * A colleague's export added beside this project's codings. Documents match
 * by id with the same text, then by the same text, then by name with the
 * same length; codes match by id, then label (creating the path when new).
 * Their coder names are kept; an identical coding already here is skipped.
 * Returns { added, duplicates, unmatchedDocuments: [names], createdCodes }.
 */
export function importCodings(s, data) {
  if (!data || data.format !== CODINGS_FORMAT || !Array.isArray(data.codings)) throw new Error('Not a Lykos codings export');
  const q = qualOf(s);
  const docMap = new Map(), unmatchedDocuments = [];
  for (const d of data.documents || []) {
    const hit = q.documents.find(x => x.id === d.id && hashText(x.text) === d.hash) || q.documents.find(x => hashText(x.text) === d.hash)
      || q.documents.find(x => x.name.toLowerCase() === String(d.name || '').toLowerCase() && x.text.length === d.length);
    if (hit) docMap.set(d.id, hit.id); else unmatchedDocuments.push(d.name || d.id);
  }
  const before = q.codes.length, codeMap = new Map();
  for (const c of data.codes || []) {
    const mine = q.codes.find(x => x.id === c.id) || q.codes.find(x => x.label.toLowerCase() === String(c.label || '').toLowerCase());
    if (mine) { codeMap.set(c.id, mine.id); continue; }
    let parent = null;
    for (const part of (c.path?.length ? c.path : [c.label])) { const id = ensureCode(s, part); if (parent && id !== parent && !q.codes.find(x => x.id === id).parent) setParent(s, id, parent); parent = id; }
    codeMap.set(c.id, parent);
  }
  let added = 0, duplicates = 0;
  for (const x of data.codings) {
    const docId = docMap.get(x.docId); if (!docId) continue;
    const codeIds = (x.codeIds || []).map(id => codeMap.get(id)).filter(Boolean);
    const same = q.codings.find(y => y.docId === docId && y.start === x.start && y.end === x.end && (y.coder || '') === (x.coder || '') && codeIds.every(id => y.codeIds.includes(id)));
    if (same) { duplicates++; continue; }
    if (addCoding(s, { docId, start: x.start, end: x.end, codeIds, coder: x.coder || '', exemplar: x.exemplar, weight: x.weight })) added++;
  }
  return { added, duplicates, unmatchedDocuments, createdCodes: q.codes.length - before };
}
export const coders = s => [...new Set(readQual(s).codings.map(x => x.coder || ''))].sort();

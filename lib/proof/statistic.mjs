// The statistic a number of the paper is (Assurance plan, step 2, 15 Nov 2026): a mean or a median for an estimate; an SD, an SE, or a
// limit of a range or an IQR for the number after it. A value is proven only by a number of its own statistic: a median read into a mean
// column, an SE into an SD column (or the reverse) and an IQR's or a range's limit read as an SD are the commonest extraction errors of a
// meta-analysis, and "the number is in the paper" does not catch them. The paper's own words decide, nearest first: the word beside the
// number ("median 20.4", "SD 13.5"), the bracket after it ("−14.5 (inter-quartile range …)" is a median), a registry record's
// paramType, the row, column and caption of the table it stands in ("Baseline seizures per month (median)", "Table 2 … (mean ± SE)"),
// and last the report's own default ("All means are shown ± standard error except where otherwise indicated"). A number whose statistic
// the paper does not say is not judged by this.

import { pageAt } from './text-index.mjs';

const EST_WORD = /\b(medians?|means?|average)\b/gi;
const estOfWord = w => (/^median/i.test(w) ? 'median' : 'mean');
// (whole words: "severity" is no SE; 15 Nov 2026, Sham; a declaration may break across lines: "[standard\ndeviation] 13.6",
// Cukiert 2017, work queue row 19)
const SPREAD_WORD = /(?:\b(SDs?|SEMs?|SEs?|s\.d\.)(?![A-Za-z])|(standard\s+deviations?|standard\s+errors?(?:\s+of\s+the\s+mean)?))/gi;
const spreadOfWord = w => (/^(?:SEM?|standard\s+err)/i.test(w) ? 'se' : 'sd');
const FLAT = s => String(s || '').replace(/\u0003/g, '±').replace(/\u0005/g, '−');

/** The estimate statistic texts declare, nearest first: the first text that names one of mean or median and not the other. */
export function declaredEstimate(...texts) {
  for (const t of texts) {
    const x = FLAT(t), med = /\bmedians?\b/i.test(x), mean = /\b(?:means?|average)\b/i.test(x);
    if (med !== mean) return med ? 'median' : 'mean';
  }
  return '';
}
/** The spread statistic texts declare ("(± SD)", "mean ± SE", "Mean (SD)"), nearest first: the first that names SD or SE and not both. */
export function declaredSpread(...texts) {
  for (const t of texts) {
    const x = FLAT(t), ws = [...x.matchAll(SPREAD_WORD)].map(m => spreadOfWord(m[0]));
    if (ws.length && ws.every(w => w === ws[0])) return ws[0];
    if (/\b(?:IQR|inter-?quartile)\b/i.test(x) && !ws.length) return 'iqr';
  }
  return '';
}

// a report's or a table's own declaration ("All means are shown ± standard error except where otherwise indicated", "Data are presented as
// mean ± SD", a table's footnote "Plus–minus values are means ±SD"): the one on the number's page (a footnote under its table) decides,
// else the report's, when all of its declarations agree
const DECL = /\b(?:all\s+)?(?:means?|values|data|results)\b[^.;]{0,40}?\b(?:are|were|is)\s+(?:(?:shown|given|presented|expressed|reported|listed|displayed)\s+(?:as\s+)?)?(?:the\s+)?(?:means?\s*)?(?:±|\+\/-|plus or minus|\b6\b)?\s*(?:\(\s*)?(?:the\s+)?(SD|SEM|SE|standard deviations?|standard errors?)\b|\bmeans?\s*(?:\(\s*)?(?:±|\+\/-)\s*(SD|SEM|SE)\b/gi;
function declarations(ix, src) {
  ix._spreadDecl ||= {};
  const k = src ?? 0;
  if (ix._spreadDecl[k]) return ix._spreadDecl[k];
  const S = ix.sources?.[k], off = S ? S.start : 0, t = S ? ix.t.slice(S.start, S.end) : ix.t;
  // (a column header "Mean ± SD" declares too)
  return (ix._spreadDecl[k] = [...t.matchAll(DECL)].map(m => ({ at: off + m.index, page: pageAt(ix, off + m.index), kind: spreadOfWord(m[1] || m[2]) })));
}
// the line an offset stands on
function lineAt(ix, off) {
  let lo = 0, hi = ix.lines.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ix.lines[m].s <= off) lo = m; else hi = m - 1; }
  return lo;
}
// a declaration on the number's page is the number's when it belongs to the number's own table (its caption, header or footnote) or, for
// a number of the running text, to no table: no line of another table stands between them (15 Nov 2026, review: the next footnote on the
// page may be another table's)
function ownDeclaration(ix, x, d) {
  const dl = lineAt(ix, d.at), own = x.table || '', dt = ix.lines[dl]?.table || '';
  const between = ix.lines.slice(Math.min(dl, x.line), Math.max(dl, x.line) + 1).map(L => L.table || '').filter(Boolean);
  if (own) {
    if (dt === own) return true;
    // a footnote under the number's table, its line already out of the table (a long sentence ends a table region)
    return d.at > x.s && !dt && between.every(T => T === own);
  }
  // a number outside any table region: a declaration of the running text with no table between, or of the one table that stands
  // between them (a table whose rows the text layer printed before its caption: Olanow 2003, "… (mean ± SE)" after its rows)
  return !dt ? !between.length : between.every(T => T === dt);
}
function declaredFor(ix, x, { pageOnly = false } = {}) {
  const D = declarations(ix, x.src);
  if (!D.length) return '';
  const here = D.filter(d => d.page === x.page && ownDeclaration(ix, x, d));
  if (here.length) { const after = here.filter(d => d.at > x.s); return (after[0] || here[here.length - 1]).kind; }
  // (a declaration of another table on the page does not speak for the number; the report's default does only when all agree, and only
  // for a number after ±: "All means are shown ± standard error" does not type "39·0 (8·7)" of a table row that says SD; Sham 2011)
  if (pageOnly) return '';
  return D.every(d => d.kind === D[0].kind) ? D[0].kind : '';
}

// the table cells a number of the text layer may be: cells of a table of the same page that hold it, as the estimate (first number of a
// cell) or the spread (the number after ±); each with its row label, column header and caption. When several cells hold the same number,
// the one whose row label stands on the number's own line is it (15 Nov 2026, review: the first such cell on the page was taken)
const NORM = s => FLAT(s).toLowerCase().replace(/\s+/g, ' ').trim();
function tableContexts(ix, x, tables, as) {
  if ((x.src ?? 0) !== 0 || !tables?.length) return [];
  const raw = x.raw.replace(/^-/, ''), out = [];
  // a spread's cell is the pair the text layer prints: the number before it in the cell is the one before it in the text ("55 ± 33", not
  // "31 (28, 33)"; Sham, 15 Nov 2026)
  const i = ix.nums.indexOf(x), prev = i > 0 ? ix.nums[i - 1].raw.replace(/^-/, '') : '';
  const holders = [];
  for (const T of tables) {
    if (T.page !== x.page) continue;
    const rows = T.rows.map(r => r.map(c => FLAT(c)));
    const fd = rows.findIndex(r => r.slice(1).some(c => /\d/.test(c))), headEnd = fd < 0 ? 1 : fd;
    for (const [ri, r] of rows.entries()) for (const [ci, cell] of r.entries()) {
      if (!ci) continue;
      const nums = [...cell.matchAll(/(?<![\d.])\d+(?:[.,]\d+)?/g)].map(m => m[0]);
      if (nums.includes(raw)) holders.push([T, ri, ci]);
      // (a cell split after its ±: "38.8 ±" then "16.3")
      const split = as === 'spread' && nums[0] === raw && /±\s*$/.test(r[ci - 1] || '');
      const at = split ? 0 : as === 'spread' ? nums.indexOf(raw, 1) : nums[0] === raw ? 0 : -1;
      const head = rows.slice(0, headEnd).map(h => h[ci] || '').join(' ');
      // (or a lone number in a row of spreads: a row "SE" under a row of means; or in a column of them, headed by the nearest row of labels
      // above it: "n | Mean | SD | Min | Max", repeated over each block of Huttunen 2023's Table 5, work queue row 19)
      const single = as === 'spread' && nums.length === 1 && nums[0] === raw;
      const loneRow = single && SPREAD_LABEL.test(FLAT(r[0]));
      const colHead = single && !loneRow ? labelRowAbove(rows, ri, ci) : '';
      const loneCol = SPREAD_LABEL.test(colHead) && !/\b(?:means?|medians?)\b/i.test(colHead);
      if (!loneRow && !loneCol && (at < 0 || (as === 'spread' && !split && (!/±|\(/.test(cell) || (prev && nums[at - 1] !== prev))))) continue;
      out.push({ row: r.slice(0, ci).join(' '), label: r[0] || '', head: loneCol ? colHead : head, caption: `${T.caption || ''}`, lone: loneRow || loneCol, at: `${T.table}|${ri}|${ci}`, spread: declaredSpread(loneRow ? FLAT(r[0]) : loneCol ? colHead : head) });
    }
  }
  // a lone number is tied to its cell by nothing but its digits: when another cell of the page's tables holds the same number and gives it
  // another statistic (a median, a minimum, n), which cell the text layer's number is cannot be told, unless its row's label is on its line
  // (work queue row 23: the ODI's median 19 is not the VAS's SD 19)
  const lone = out.filter(c => c.lone), kinds = new Set(lone.map(c => c.spread));
  const differs = holders.some(([T, ri, ci]) => !out.some(c => c.at === `${T.table}|${ri}|${ci}`) && !(kinds.size === 1 && kinds.has(heldAs(T, ri, ci)) && heldAs(T, ri, ci)));
  if (lone.length && differs) {
    const line = NORM(lineText(ix, x));
    const kept = out.filter(c => !c.lone || (NORM(c.label).length >= 3 && line.includes(NORM(c.label))));
    out.length = 0; out.push(...kept);
  }
  if (out.length > 1) { const line = NORM(lineText(ix, x)), on = out.filter(c => NORM(c.label).length >= 3 && line.includes(NORM(c.label))); if (on.length) return on; }
  return out;
}
// the spread a cell's own column head or row label gives it ('' when it gives none: a mean, a median, n, a minimum)
function heldAs(T, ri, ci) {
  const rows = T.rows.map(r => r.map(c => FLAT(c)));
  return declaredSpread(labelRowAbove(rows, ri, ci)) || declaredSpread(rows[ri][0] || '');
}
const SPREAD_LABEL = /\b(?:SDs?|SEMs?|SEs?|IQR)\b|standard\s+(?:deviation|error)/i;
// the label of column ci in the nearest row above row ri that holds no number after its first cell (a block's own header row)
function labelRowAbove(rows, ri, ci) {
  // (a label may hold digits: "Week 12" heads a block of its own; a row is one of values when a cell of it is a number and nothing else;
  // work queue row 23)
  const numCell = c => /^\s*[<>≤≥±~≈]?\s*[−–-]?\d+(?:[.,·]\d+)?\s*[%*†‡§¶]*\s*$/.test(c);
  for (let k = ri - 1; k >= 0; k--) if (!rows[k].slice(1).some(numCell)) return rows[k][ci] || '';
  return '';
}
// the statistic the cells declare, when they agree
function tableDeclares(Ts, read) {
  const ds = new Set(Ts.map(T => read(T.row, T.head, T.caption)));
  return ds.size === 1 ? [...ds][0] : '';
}
function lineText(ix, x) { const L = ix.lines[x.line]; return L ? ix.t.slice(L.s, L.e) : ''; }

// does a clause about a measure begin between offsets a and b: a number, a clause boundary (a comma, a semicolon, "and", "but"), then a
// measure the paper names ("Median follow-up was 24 months, and the ODI improved from 42.5")
function newClause(ix, a, b) {
  const seg = ix.t.slice(a, b).replace(/\([^()]*\)/g, m => ' '.repeat(m.length)), m = seg.match(/\d[^]*?(?:[,;]|\b(?:and|but|whereas|while)\b)/i);
  if (!m) return false;
  const from = a + m.index + m[0].length;
  return Object.values(ix.mentions || {}).some(hits => hits.some(h => h.s >= from && h.e <= b));
}
/** The estimate statistic of number x: 'median', 'mean' or ''. */
export function estimateStatAt(ix, x, tables = []) {
  const t = ix.t, after = t.slice(x.e, x.e + 40);
  // the bracket after it: an IQR goes with a median; "(median)" and "(mean)" name it
  if (/^\s*%?\s*[([]\s*(?:IQR|inter-?quartile|interquartile)\b/i.test(after)) return 'median';
  const named = after.match(/^\s*%?\s*\(\s*(median|mean)\b/i);
  if (named) return estOfWord(named[1]);
  // a registry record's value: the paramType of its measure
  if (/"value"\s*:\s*"\s*$/.test(t.slice(Math.max(0, x.s - 14), x.s))) {
    const back = t.slice(Math.max(0, x.s - 4000), x.s), pt = [...back.matchAll(/"paramType"\s*:\s*"([A-Z_]+)"/g)].pop();
    if (pt) return /MEDIAN/.test(pt[1]) ? 'median' : /MEAN/.test(pt[1]) ? 'mean' : '';
  }
  // the word before it in its sentence: the nearest of mean and median, with no other estimate's statistic between, and in its clause: a
  // word another number has taken, a clause boundary after that number, is not this number's ("Median follow-up was 24 months, and the
  // ODI improved from 42.5": 42.5 is no median; 15 Nov 2026, review)
  const S = ix.sents[x.sent], from = Math.max(S ? S.s : 0, x.s - 90), before = t.slice(from, x.s);
  // (a closed bracket that holds numbers is another value's: "10·2% (SD 58·3; median change 1·1% […]) … and 4·2%" is a mean; Sham 2017)
  const words = [...before.replace(/\([^()]*\)/g, m => (/\d/.test(m) ? ' '.repeat(m.length) : m)).matchAll(EST_WORD)], w = words[words.length - 1];
  // (a bracket's numbers and commas are its own: "median (25th, 75th percentile) ODI was 42.5")
  // (only a new clause about a measure ends the word's reach: "The median ODI was 30.1 before and 42.5 after surgery" and "… at 6, 12 and 24
  // months was 30.1, 28.4 and 42.5" keep it; 15 Nov 2026, second review)
  if (w && !newClause(ix, from + w.index + w[0].length, x.s)) return estOfWord(w[1]);
  // a table: the row, then the column, then the caption
  const Ts = tableContexts(ix, x, tables, 'estimate');
  if (Ts.length) return tableDeclares(Ts, declaredEstimate);
  return '';
}

/** The spread statistic of number x, read as the spread of the estimate before it: 'sd', 'se', 'iqr', 'range' or ''. */
export function spreadStatAt(ix, x, tables = []) {
  const t = ix.t, before = t.slice(Math.max(0, x.s - 40), x.s), after = t.slice(x.e, x.e + 20);
  // a limit of a range or an interquartile range: "17.2 (12–38)", "IQR 10 to 35", "(range, 4–9)"
  // (a hyphen with a space before it and none after is the next number's minus: "10.09 -8.14" is two numbers, not a range)
  if (/^(?:\s*–\s*|-(?=\s*[−-]?\d)|\s+-\s+|\s+to\s+)[−-]?\d/.test(after) || /\d(?:\s*–\s*|-|\s+-\s+|\s+to\s+)[−-]?$/.test(before)) return /\b(?:IQR|inter-?quartile|interquartile)\b[^()]{0,20}$/i.test(before) || /\b(?:IQR|inter-?quartile|interquartile)\b/i.test(before.slice(-30)) ? 'iqr' : 'range';
  // a limit of a bracket of two numbers: "42.5 (12.0, 55.0)", "(12.0; 55.0)" (an IQR or a range written with a comma; 15 Nov 2026, review)
  const N = '[−\\u0005-]?\\d+(?:\\.\\d+)?';
  if ((new RegExp(`^\\s*[,;]\\s+${N}\\s*[)\\]]`).test(after) && /[(\[]\s*$/.test(before)) || (new RegExp(`[(\\[]\\s*${N}\\s*[,;]\\s+$`).test(before) && /^\s*[)\]]/.test(after))) return /\b(?:IQR|inter-?quartile|interquartile)\b/i.test(before.slice(-40)) ? 'iqr' : 'range';
  // its own word: "(SD 13.5)", "SE = 2.8", "± SEM 1.2"
  const own = before.match(/(?:\b(SD|SEM|SE|s\.d\.)|(standard\s+deviation|standard\s+error))\s*\]?\s*[:=,]?\s*(?:±\s*)?$/i);
  if (own) return spreadOfWord(own[0].trim());
  // or the word after it, when it is a spread: "42.5 ± 3.1 SE", "42.5 ± 3.1 (SE)", "42.5 (3.1 SD)" (15 Nov 2026, review)
  const ownAfter = after.match(/^\s*[(\[]?\s*(SDs?|SEMs?|SEs?|s\.d\.|standard deviations?|standard errors?)(?![A-Za-z])/i);
  if (ownAfter && (x.pm || /\d\s*[(\[]\s*$/.test(before))) return spreadOfWord(ownAfter[1]);
  // after ± (or in "mean (x)"): the sentence or line that declares it, the table, then the report's default
  const S = ix.sents[x.sent], sentBefore = t.slice(Math.max(S ? S.s : 0, x.s - 200), x.s);
  const local = declaredSpread(sentBefore.replace(/.*\n\s*\n/s, ''));
  if (local === 'sd' || local === 'se') return local;
  const Ts = tableContexts(ix, x, tables, 'spread');
  if (Ts.length) { const d = tableDeclares(Ts, declaredSpread); if (d) return d; }
  if (x.table) { const d = declaredSpread(lineText(ix, x)); if (d) return d; }
  // a declaration speaks for a number after ± and for one in brackets after its estimate ("42.5 (3.1)" under "Values are mean (SE)")
  if (x.pm) return declaredFor(ix, x);
  // a bare number of a table region: its own table's declaration ("Table 2 ODI (mean ± SE)" over a row of SEs)
  if (x.table && !/[(\[]\s*$/.test(before)) return declaredFor(ix, x, { pageOnly: true });
  return /\d\s*%?\s*[(\[]\s*$/.test(before) && /^\s*[)\]]/.test(after) ? declaredFor(ix, x, { pageOnly: true }) : '';
}

/** Is number x printed as a p-value? "p < 0.05", "P = .376", "p-value of 0.03", and as the text layer prints the signs: "," for "<" (AANS
 * journals, "p , 0.05"), "¼" for "=" (Elsevier), "5" for "=" (Neurology: "p 5 0.91"). A p-value proves only a p-value (work queue row 23: Velasco 2008's "0" from "p , 0.05"). */
export const P_LEAD = String.raw`(?:^|[^A-Za-z])[Pp](?:[- ]?values?|\s*\(\s*(?:trend|interaction|heterogeneity)\s*\)|\s+for\s+(?:trend|interaction|heterogeneity))?`;
const P_BEFORE = new RegExp(String.raw`${P_LEAD}\s*(?:(?:[<>=≤≥¼,:]|1\u20444|\u0001|\u0002)\s*|\s5\s+|(?:of|was|were|is)\s+)$|(?:^|[^A-Za-z])[Pp](?:[- ]?values?|\s+for\s+(?:trend|interaction|heterogeneity))\s+$`);
export function pValueAt(ix, x) {
  if (!(Math.abs(x.v ?? x.vals?.[0]?.v ?? 2) <= 1)) return false;
  const before = ix.t.slice(Math.max(0, x.s - 16), x.s);
  // (or a table's cell "<0.001" on a line of its own, as a P column prints it)
  return P_BEFORE.test(before) || (!!x.table && /(?:^|\n)[ \t]*[<≤][ \t]*$/.test(before));
}

/** Does a found statistic contradict the wanted one? Unknown (either side '') never does. */
export function statClash(want, found) {
  if (!want || !found || want === found) return false;
  return true;
}

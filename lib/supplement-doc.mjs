// The supplementary material as a document of the package (Batch 13 item 6; plan §4.4; lib/package-sources.mjs `generated: 'supplement'`):
// the tables a review's supplement carries, written from the project at each build, so the supplement is rebuilt by Build and never by a
// script in the folder. Each table is numbered S1, S2, … in this order and only when the project holds it:
//   the master evidence table (the first extraction table, every included study, every column, one row per arm);
//   the search strategies (each database, the date, the full query, the records it gave);
//   the GRADE certainty of evidence in the journal's layout (lib/sof.mjs gradeTable);
//   the pooled analyses (estimate, interval, prediction interval, heterogeneity, studies, model, leave-one-out range).
// Figures stay figure items of the package (they are placed and numbered there). Pure over the project state: nothing is computed that the
// pages have not computed; an analysis is reported as it was run.
import { evidenceGrid } from './package-select.mjs';
import { gradeTable, gradeTableBlocks } from './sof.mjs';
import { outcomes, analysisOf } from './outcomes.mjs';

const str = v => (v == null ? '' : String(v)).trim();
let n = 0;
const bid = () => `sp${(n++).toString(36)}`;
const para = text => ({ id: bid(), type: 'p', styleId: 'Normal', props: {}, text, runs: [{ t: text }] });
const heading = (text, type) => ({ id: bid(), type, text, runs: [{ t: text }] });
const cell = (text, b = false) => ({ runs: [{ t: str(text), ...(b ? { b: true } : {}) }] });
const table = (cols, head, rows) => ({ id: bid(), type: 'table', text: '', grid: { cols, borders: 'horizontal',
  rows: [{ header: true, cells: head.map(h => cell(h, true)) }, ...rows.map(r => ({ header: false, cells: r.map(c => cell(c)) }))] } });
/** "Table S2. Search strategies": the caption rule of the project's figures and tables, lead sentence only. */
const caption = (no, text) => ({ ...heading(`Table S${no}. ${text}`, 'h1'), runs: [{ t: `Table S${no}. `, b: true }, { t: text }] });

const pct = v => `${Number((v * 100).toPrecision(12)).toFixed(1)}%`;   // 0.0715 is 7.2%, not the 7.1% its binary form rounds to
const fixed = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
/** An estimate in its measure's own units: a proportion as a percentage, a ratio or difference as a number. */
export function shownValue(a, v) { return Number.isFinite(v) ? (a?.measure === 'PR' ? pct(v) : fixed(v)) : ''; }
const interval = (a, lo, hi) => (Number.isFinite(lo) && Number.isFinite(hi) ? `${shownValue(a, lo)} to ${shownValue(a, hi)}` : '');

/** The master table: the first extraction table's grid of every included study, header first; null when nothing is extracted. */
function masterTable(s) {
  const t = (s.templates || [])[0];
  if (!t) return null;
  let g;
  try { g = evidenceGrid(s, { evidence: t.id }); } catch { return null; }
  if (!g || g.rows.length < 2) return null;
  return { name: t.name || 'Evidence table', block: { id: bid(), type: 'table', text: '', grid: { cols: g.cols, borders: 'horizontal',
    rows: g.rows.map(r => ({ header: !!r.header, cells: r.cells.map(c => cell(c.merged ? '' : c.text, !!r.header)) })) } } };
}

/** The search log as rows: database, date, query, records. */
export function searchRows(s) {
  return (s.searches || []).filter(r => r && str(r.query)).map(r => [str(r.source) || 'Database', str(r.at).slice(0, 10), str(r.query), r.total ?? r.retrieved ?? '']);
}

/** The pooled analyses as rows: outcome, studies, estimate with its interval, prediction interval, I², model, leave-one-out range. */
export function analysisRows(s) {
  let list = [];
  try { list = outcomes(s).filter(o => !o.hidden); } catch { return []; }
  return list.map(o => [o, analysisOf(s, o.id)]).filter(([, a]) => a && Number.isFinite(a.estimate)).map(([o, a]) => [
    o.name || a.outcomeName || 'Outcome', a.k ?? '', `${a.measure ? `${a.measure} ` : ''}${shownValue(a, a.estimate)} (${interval(a, a.lo, a.hi)})`,
    interval(a, a.pi_lo, a.pi_hi), Number.isFinite(a.i2) ? `${Math.round(a.i2 > 1 ? a.i2 : a.i2 * 100)}%` : '', str(a.method),
    Number.isFinite(a.loo_lo) && Number.isFinite(a.loo_hi) ? interval(a, a.loo_lo, a.loo_hi) : '',
  ]);
}

/** The document's blocks, the title first; each table only when the project holds its rows. `title` names the review. */
export function supplementBlocks(s, { title = '' } = {}) {
  n = 0;
  const name = title || str(s.paper?.title) || str(s.protocol?.title) || str(s.project?.name);
  const out = [heading('Supplementary material', 'title')];
  if (name) out.push(para(name));
  let no = 0;
  const master = masterTable(s);
  if (master) { out.push(caption(++no, `${master.name}: every included study`), master.block); }
  const searches = searchRows(s);
  if (searches.length) { out.push({ ...caption(++no, 'Search strategies'), props: { pageBreakBefore: no > 1 } }, table([80, 60, 280, 48], ['Database', 'Date', 'Search strategy', 'Records'], searches)); }
  if ((s.grade || []).length) {
    const g = gradeTableBlocks(gradeTable(s)).slice(1);   // its own title replaced by the numbered caption
    out.push({ ...caption(++no, 'GRADE certainty of evidence'), props: { pageBreakBefore: no > 1 } }, ...g);
  }
  const pooled = analysisRows(s);
  if (pooled.length) {
    out.push({ ...caption(++no, 'Pooled analyses'), props: { pageBreakBefore: no > 1 } },
      table([110, 36, 110, 90, 36, 46, 90], ['Outcome', 'Studies', 'Estimate (95% CI)', 'Prediction interval', 'I²', 'Model', 'Leave-one-out range'], pooled));
  }
  if (!no) out.push(para('Nothing to report yet: no extraction table, search, GRADE row or pooled analysis is recorded.'));
  return out;
}

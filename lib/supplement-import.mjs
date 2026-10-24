// What a review's supplementary tables already say, read into the project
// (plan §4.15a): the search strategies with their yields as the search log,
// and the JBI appraisal tables as assessments. Nothing is inferred beyond the
// tables' own words; a row that cannot be matched to a library record is
// returned as unmatched, not attached to the nearest.
import { cellText } from './docx-tables.mjs';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "25 May 2026", "May 25, 2026", "2026-05-25" as a day, or ''. */
export function dayOfText(text) {
  const t = fold(text);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/.exec(t);
  const mi = m ? MONTHS.findIndex(x => x.startsWith(m[2].slice(0, 3))) : -1;
  if (m && mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  m = /([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  const mj = m ? MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3))) : -1;
  return m && mj >= 0 ? `${m[3]}-${String(mj + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` : '';
}

const DATABASE = [['PubMed', /pubmed|medline/i], ['Web of Science', /web.?of.?science|\bwos\b/i], ['Scopus', /scopus/i], ['Embase', /embase/i],
  ['Cochrane Library', /cochrane|central/i], ['CINAHL', /cinahl/i], ['PsycINFO', /psycinfo/i]];
const databaseName = t => DATABASE.find(([, re]) => re.test(t))?.[0] || String(t).trim();

/**
 * The search strategies of every table headed Database, Search string, Date,
 * Records: `[{ label, caption, searches: [{ source, query, day, retrieved }], total, totalStated }]`.
 * `totalStated` is the table's own "Total" row; `total` the sum of the rows, so a
 * table whose total is not their sum is visible.
 */
export function searchTables(tables = []) {
  const out = [];
  for (const t of tables) {
    const h = t.header.map(fold);
    const db = h.findIndex(x => /^(database|source)/.test(x)), q = h.findIndex(x => /search|query|strategy/.test(x)),
      dt = h.findIndex(x => /date/.test(x)), n = h.findIndex(x => /records|results|hits|yield/.test(x));
    if (db < 0 || q < 0 || n < 0) continue;
    const searches = [];
    let totalStated = null;
    for (const r of t.rows) {
      const name = r[db] || '';
      if (/^total/i.test(name)) { totalStated = Number((r.find((c, i) => i !== db && /^\d+$/.test(c.replace(/[,\s]/g, ''))) || '').replace(/[,\s]/g, '')) || null; continue; }
      if (!name || !r[q]) continue;
      searches.push({ source: databaseName(name), query: r[q], day: dt >= 0 ? dayOfText(r[dt]) : '', dateText: dt >= 0 ? r[dt] : '', retrieved: Number(String(r[n]).replace(/[,\s]/g, '')) });
    }
    if (searches.length) out.push({ caption: t.caption, table: t.index, searches, total: searches.reduce((a, s) => a + (Number.isFinite(s.retrieved) ? s.retrieved : 0), 0), totalStated });
  }
  return out;
}

const TOOLS = [{ items: 8, id: 'jbi-case-report', name: 'JBI case report' }, { items: 10, id: 'jbi-case-series', name: 'JBI case series' }];
const JUDGEMENT = w => { const t = fold(w).trim(); return t === 'yes' || t === 'y' ? 'Yes' : t === 'no' || t === 'n' ? 'No' : t.startsWith('unclear') ? 'Unclear' : /^(na|n\/a|not applicable)/.test(t) ? 'Not applicable' : ''; };
/**
 * JBI checklists written as tables: a Study column, Q1…Qn, and optionally an
 * overall grade. The instrument follows the number of items (8 for a case
 * report, 10 for a case series), confirmed by the caption where it says so.
 * Rows give the study's text, the works cited beside it, and the answers as
 * the app's judgements ("Yes", "No", "Unclear", "Not applicable"); a cell
 * that is none of these is listed in `unread`, and the row keeps no answer
 * for it.
 */
export function appraisalTables(tables = []) {
  const out = [];
  for (const t of tables) {
    const qs = t.header.map((x, i) => ({ x, i })).filter(c => /^q\s*\d+$/i.test(c.x.trim()));
    const study = t.header.findIndex(x => /^(study|studies|report|article|author)/i.test(x.trim()));
    if (qs.length < 6 || study < 0) continue;
    const tool = TOOLS.find(x => x.items === qs.length);
    if (!tool) continue;
    const cap = fold(t.caption || t.heading);
    const named = /case reports?/.test(cap) && tool.id !== 'jbi-case-report' ? 'the caption says case reports but the table has 10 items' : /case series/.test(cap) && tool.id !== 'jbi-case-series' ? 'the caption says case series but the table has 8 items' : '';
    const overall = t.header.findIndex(x => /risk of bias|overall|quality|grade/i.test(x));
    const rows = [], unread = [];
    t.rows.forEach((r, k) => {
      if (!r[study]) return;
      const answers = {};
      for (const [j, c] of qs.entries()) {
        const v = JUDGEMENT(r[c.i]);
        if (v) answers[`q${j + 1}`] = v; else if (r[c.i]) unread.push(`${r[study]} ${c.x}: ${r[c.i]}`);
      }
      rows.push({ study: r[study], cites: t.cites[k] || [], answers, grade: overall >= 0 ? r[overall] : '' });
    });
    out.push({ caption: t.caption || t.heading, table: t.index, tool: tool.id, toolName: tool.name, rows, unread, ...(named ? { warning: named } : {}) });
  }
  return out;
}

/** "Chung et al., 2007" into a family name and year, to find the record when no citation is beside it. */
export function studyLabel(text) {
  const { text: t } = cellText(text);
  const m = /^(.+?)(?:\s+et al\.?)?,?\s*(?:\(?)((?:19|20)\d{2})[a-z]?\)?\s*\d*$/i.exec(t);
  return m ? { family: m[1].trim(), year: m[2] } : null;
}

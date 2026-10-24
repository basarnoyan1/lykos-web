// A risk-of-bias workbook read into the project's appraisal (plan H2, H3): the judgements a review made outside the app, with the passages it
// quoted for them, become assessments the Appraisal page shows, the traffic lights draw and the results read.
//
// A workbook is read by what its sheets say, not by their names in one review: a sheet is an instrument's table when its columns are its domains or
// items ("D1 Bias due to confounding", "Q1", "Overall"), and a support sheet when its columns are study, domain or item, judgement, a quotation and
// a rationale. The instrument comes from the sheet's name (RoB 2, ROBINS-I, ROBINS-I V2, JBI case series, JBI case report). A study is matched to an
// included record by its name ("Akgun 2024"), never by the workbook's own number, which may follow another numbering; a name that matches no
// included record, or more than one, is returned unmatched and nothing is written for it.
//
// Pure over the workbook as lib/xlsx-read.mjs gives it ({ sheets: [{ name, rows }] }) and the project state.
import { allTools } from '../schema.mjs';
import { toTool, toolId as customId } from './custom-instrument.mjs';
import { saveInstrument } from './appraisal-custom.mjs';
import { setAnswer, STUDY } from './rob-review.mjs';
import { isIncluded } from './screen.mjs';

const fold = t => String(t ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
/** The instrument a sheet's name names, most specific first. */
const TOOL_OF = [[/robins\s*-?\s*i\s*v\s*2|robins-i v2/i, 'robins-i-v2'], [/robins\s*-?\s*e/i, 'robins-e'], [/robins\s*-?\s*i/i, 'robins-i'], [/rob\s*-?\s*2/i, 'rob2'],
  [/jbi.*case\s*series/i, 'jbi-case-series'], [/jbi.*case\s*report/i, 'jbi-case-report'], [/\bjbi\b/i, 'jbi']];
export const toolOfSheet = name => TOOL_OF.find(([re]) => re.test(String(name)))?.[1] || null;
/** The family of an instrument: ROBINS-I and its V2 are one, the JBI checklists are one ("ROBINS-I support" beside a "ROBINS-I V2" table is V2's). */
const familyOf = id => (id || '').replace(/^custom-/, '').replace(/-v2$/, '').replace(/^jbi-.*/, 'jbi');

// Levels in the order risk-of-bias instruments rank them, most favourable first, to order an instrument a workbook defines.
const RANKED = ['low', 'low except for concerns about uncontrolled confounding', 'yes', 'some concerns', 'moderate', 'unclear', 'serious', 'high', 'no', 'critical', 'very high'];
/**
 * An instrument the app does not ship, defined by a workbook's table (ROBINS-I V2 before the app knows it): its domains are the table's D columns
 * with their own names, its levels the values the table uses, ranked as instruments rank them, any other value kept as an unranked level; the
 * overall is the review's own (manual) when the table has one. It becomes the project's own instrument (lib/custom-instrument.mjs).
 */
function instrumentFrom(id, name, head, rows) {
  const domains = [], levels = new Set();
  head.forEach((h, i) => { const m = /^D(\d{1,2})\s+(.+)$/i.exec(h); if (m) domains.push({ id: `d${m[1]}`, name: m[2].replace(/^bias (due to|in)\s+/i, s => s), questions: [], at: i }); });
  const overallAt = head.findIndex(h => /^overall$/i.test(h));
  for (const r of rows.slice(1)) for (const at of [...domains.map(d => d.at), overallAt]) if (at >= 0 && cell(r[at])) levels.add(cell(r[at]));
  const known = [...levels].filter(l => RANKED.includes(fold(l))).sort((a, b) => RANKED.indexOf(fold(a)) - RANKED.indexOf(fold(b)));
  const other = [...levels].filter(l => !RANKED.includes(fold(l)));
  if (domains.length < 1 || known.length < 2) return null;
  return { id, name, design: '', judgements: [...known, ...other], unranked: other, domains: domains.map(({ at, ...d }) => d), overall: overallAt >= 0 ? 'manual' : 'none' };
}

const cell = v => (v == null ? '' : String(v).trim());
/** The domain id a header names in an instrument: "D3 Bias in …" → its third domain, "Q4" → q4, "Overall" → overall. */
function domainOf(tool, header) {
  const h = cell(header);
  if (/^overall$/i.test(h) || /^overall (judg|risk)/i.test(h)) return tool.overall ? 'overall' : null;
  const m = /^(D|Q)(\d{1,2})\b/i.exec(h);
  if (!m) return null;
  const d = tool.domains.find(x => fold(x.short) === fold(`${m[1]}${m[2]}`));
  return d ? d.id : null;
}
/** A judgement as the instrument words it ("serious" → "Serious"); a word it does not know is kept as written. */
const judged = (tool, v) => { const t = cell(v); if (!t) return ''; return tool.judgements.find(j => fold(j) === fold(t)) || t; };

/**
 * What the workbook holds: `{ studies: [{ study, tool, answers: { domain: value }, support: [{ domain, judgement, quote, page, rationale }] }], sheets }`
 * (one entry per study and instrument). `sheets` says what each sheet was read as.
 */
export function readRobWorkbook(book, s = {}) {
  const tools = [...allTools(s)], byKey = new Map(), sheets = [], instruments = [];
  // an instrument named by a table sheet that the app does not know is defined from that sheet, first, so its support sheets can use it
  for (const sh of book?.sheets || []) {
    const named = toolOfSheet(sh.name), head = (sh.rows?.[0] || []).map(cell);
    if (!named || tools.some(t => t.id === named || t.id === customId(named)) || !head.some(h => /^D\d/i.test(h))) continue;
    const inst = instrumentFrom(named, cell(sh.name), head, sh.rows || []);
    if (!inst) continue;
    try { tools.push(toTool(inst)); instruments.push(inst); } catch { /* a table that does not make an instrument is not read */ }
  }
  const idOf = named => tools.find(t => t.id === named || t.id === customId(named))?.id || null;
  // a sheet that names only a family takes the instrument of the table sheet of that family, when the workbook has one
  const tableShaped = sh => (sh.rows?.[0] || []).some(h => /^(D|Q)\d{1,2}\b/i.test(cell(h)));   // domain or item columns: an instrument's table, not its support
  const tables = (book?.sheets || []).filter(tableShaped).map(sh => idOf(toolOfSheet(sh.name))).filter(Boolean);
  // a sheet that names a family (ROBINS-I, JBI) is the family's table instrument when the workbook has one, else the instrument it names
  const resolve = named => { const own = idOf(named), fam = familyOf(named), same = tables.filter(x => familyOf(x) === fam);
    return own && same.includes(own) ? own : same.length === 1 ? same[0] : own || same[0] || null; };
  const entry = (study, toolId) => { const k = `${fold(study)}|${toolId}`; if (!byKey.has(k)) byKey.set(k, { study: cell(study), tool: toolId, answers: {}, support: [] }); return byKey.get(k); };
  for (const sh of book?.sheets || []) {
    const named = toolOfSheet(sh.name), toolId = named ? resolve(named) : null, tool = tools.find(t => t.id === toolId);
    const rows = sh.rows || [], head = (rows[0] || []).map(cell), col = re => head.findIndex(h => re.test(h));
    const studyAt = col(/^study$/i);
    if (!tool || studyAt < 0) { sheets.push({ name: sh.name, as: 'not read' }); continue; }
    const itemAt = col(/^(domain|item)$/i), answerAt = col(/^(judg(e)?ment|answer)$/i);
    if (itemAt >= 0 && answerAt >= 0) {   // a support sheet: one row per study and domain
      const quoteAt = col(/quot/i), why = col(/rationale|reason/i);
      let n = 0;
      for (const r of rows.slice(1)) {
        const study = cell(r[studyAt]), domain = domainOf(tool, r[itemAt]);
        if (!study || !domain) continue;
        const quote = cell(r[quoteAt]), pageMatch = /\((?:p\.?|page)\s*(\d+)[^)]*\)\s*$/i.exec(quote);
        entry(study, tool.id).support.push({ domain, judgement: judged(tool, r[answerAt]), quote: pageMatch ? quote.slice(0, pageMatch.index).trim() : quote, page: pageMatch ? Number(pageMatch[1]) : '', rationale: cell(r[why]) });
        n++;
      }
      sheets.push({ name: sh.name, as: `${tool.name} support`, rows: n });
      continue;
    }
    const domains = head.map(h => domainOf(tool, h));
    if (!domains.some(Boolean)) { sheets.push({ name: sh.name, as: 'not read' }); continue; }
    let n = 0;
    for (const r of rows.slice(1)) {
      const study = cell(r[studyAt]);
      if (!study) continue;
      const e = entry(study, tool.id);
      domains.forEach((d, i) => { const v = judged(tool, r[i]); if (d && v) e.answers[d] = v; });
      n++;
    }
    sheets.push({ name: sh.name, as: tool.name, rows: n });
  }
  // a study only a support sheet judged (one row per domain, the overall among them) takes its judgements from it
  for (const e of byKey.values()) if (!Object.keys(e.answers).length) for (const x of e.support) if (x.judgement) e.answers[x.domain] = x.judgement;
  return { studies: [...byKey.values()].filter(e => Object.keys(e.answers).length || e.support.length), sheets, instruments };
}

/** The included record a study's name names, or null when none or several do. */
export function matchStudy(s, name) {
  const want = fold(name), hits = (s.papers || []).filter(p => isIncluded(s, p.id) && fold(p.label) === want);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Writes what `read` holds into the state: each study's instrument for the study, its judgements as reviewer A's at study level (lib/rob-review.mjs,
 * which keeps s.assessments in step), and each quotation as a note headed with the instrument and the domain, as the Appraisal page's Support reads
 * them. A judgement already given is replaced by the workbook's. Answers `{ written: [{ paperId, study, tool, domains, notes }], unmatched: [name] }`.
 */
export function applyRob(st, read, { by = 'workbook' } = {}) {
  for (const inst of read.instruments || []) if (!allTools(st).some(t => t.id === customId(inst.id))) saveInstrument(st, inst);   // the project's own from now on
  const tools = allTools(st), toolIds = tools.map(t => t.id), written = [], unmatched = [];
  for (const e of read.studies) {
    const p = matchStudy(st, e.study), tool = tools.find(t => t.id === e.tool);
    if (!p || !tool) { if (!unmatched.includes(e.study)) unmatched.push(e.study); continue; }
    st.appraisalByStudy = { ...(st.appraisalByStudy || {}), [p.id]: tool.id };
    for (const [domain, value] of Object.entries(e.answers)) setAnswer(st, { paperId: p.id, toolId: tool.id, level: STUDY, who: 'a', domain, value, toolIds });
    let notes = 0;
    for (const x of e.support) {
      const d = x.domain === 'overall' ? 'Overall' : tool.domains.find(y => y.id === x.domain)?.short || x.domain;
      const quote = x.quote.replace(/^["“”']+|["“”']+$/g, '').trim();   // the workbook's own quotation marks, once
      const text = `${tool.name} ${d}: ${x.judgement}${quote ? ` — "${quote}"` : ''}${x.rationale ? ` — ${x.rationale}` : ''}`;
      if ((st.notes || []).some(n => n.paper === p.id && n.text === text)) continue;
      st.notes = [...(st.notes || []), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, paper: p.id, kind: 'quote', text, page: x.page ?? '',
        extractor: `import:${by}`, verification: 'verified', at: new Date().toISOString() }];
      notes++;
    }
    written.push({ paperId: p.id, study: e.study, tool: tool.id, domains: Object.keys(e.answers).length, notes });
  }
  return { written, unmatched };
}

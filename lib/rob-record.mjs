// A review's risk-of-bias record as its authors verify it (24 Oct 2026; the Spine review's build_rob_workbook.py and build_rob_log.py, now
// drawn here): the workbook of the assessments (a summary, each instrument's judgements and their passages, the comparison with earlier
// passes, the methods, the signalling questions, the target results, the unavailable results, the instrument choices, the author
// verification sheet) and the decision log for verification (how to use it, the framework, the checks to make first, the full record of each
// study). The judgements, answers, passages and reasons are Lykos's own (finalAnswers, the passages filed for each judgement, read through
// lib/rob-log.mjs decisionLog); what Lykos does not judge is kept with each assessment record as its documentation,
// s.robReview.records[paper][tool].study.doc: { number, pdf, scope, status, version, target, availability, toolChoice, overall, confounders,
// coInterventions, interpretation, appraisalScope, adjudication, domains: { D1: { algorithm, override } }, signalling: [...], passes: [{ name,
// kind, overall, answers: { D1 | Q1: value }, reason }], checks: { D1: { status, pages } } }; the methods and the log's own texts are
// s.appraisalMethods { items: [{ item, text }], log: { title, subtitle, intro, framework, notes, items, sections } }. Pure: the state in,
// sheets for lib/xlsx-write.mjs and blocks for lib/package-build.mjs out.
import { decisionLog } from './rob-log.mjs';
import { recordOf, STUDY, OVERALL } from './rob-review.mjs';

const str = v => (v == null ? '' : String(v));
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
export const FILL = { Low: 'C6EFCE', Moderate: 'FFEB9C', 'Some concerns': 'FFEB9C', Serious: 'F8CBAD', High: 'F4B183', Critical: 'E06666', Yes: 'C6EFCE', No: 'F4B183',
  Unclear: 'FFEB9C', 'No information': 'D9D9D9', 'Not applicable': 'D9D9D9', 'Outcome not reported': 'FFFFFF', 'Not assessed': 'FFFFFF' };
const FLAG = 'FFF2CC', HEAD = 'D9E2F3';
const isChecklist = tool => /jbi|checklist/i.test(`${tool.id} ${tool.name}`);

/** Each study with an assessment and its documentation, in study-number order: the passages and reasons as Lykos files them. */
export function robRecord(s) {
  const log = decisionLog(s), out = [];
  for (const x of log.studies) {
    const lv = x.levels.find(l => l.level === STUDY) || x.levels[0];
    if (!lv) continue;
    const doc = recordOf(s, x.id, x.instrument.id, lv.level)?.doc || recordOf(s, x.id, x.instrument.id, STUDY)?.doc || {}, list = isChecklist(x.instrument);
    const entries = lv.judgements.filter(j => j.id !== OVERALL).map(j => {
      // the passages filed for the judgement as it stands (a passage filed for an earlier judgement is left out when any supports this one), each once
      const now = j.support.filter(q => !q.judgement || q.judgement === j.judgement), use = now.length ? now : j.support;
      const quotes = use.filter((q, k) => q.quote && use.findIndex(x => x.quote === q.quote) === k), pages = [...new Set(use.map(q => q.page).filter(Boolean))];
      // a passage as cited (its quotation marks straight, a checklist's own extracts and a statement of absence bare), its page after it unless it
      // ends with its own; a passage of several quotations whose first or last mark was lost when it was filed gets it back
      const cite = (t, page) => {
        let x = String(t);
        const first = x.indexOf('"');
        if (!x.startsWith('"') && first > 0 && !/[\s:(;]/.test(x[first - 1])) x = `"${x}`;
        else if (first < 0 && !list && !/^No\s/i.test(x)) x = `"${x}"`;
        if (x.startsWith('"') && (x.match(/"/g) || []).length % 2) x = x.replace(/(\s*\((?:PDF\s+)?p\.?\s*[\d,–\s-]+\))?\s*$/, m => `"${m}`);
        return page && !/\((?:PDF\s+)?p\.?\s*[\d,–\s-]+\)\s*$/.test(x) ? `${x} (p. ${page})` : x;
      };
      const support = quotes.map(q => cite(q.quote, q.page)).join(' ');
      return { short: j.short, label: list ? j.short : doc.domains?.[j.short]?.label || `${j.short} ${j.label}`, judgement: j.judgement, support, pages, rationale: [...new Set(use.map(q => q.rationale).filter(Boolean))].join(' '),
        check: doc.checks?.[j.short] || null, ...(doc.domains?.[j.short] || {}) };
    });
    const yes = entries.filter(e => e.judgement === 'Yes').length, applicable = entries.filter(e => e.judgement && e.judgement !== 'Not applicable').length;
    out.push({ id: x.id, number: Number(doc.number) || out.length + 1, label: x.label, tool: x.instrument, checklist: list, pdf: str(doc.pdf || x.pdf), entries,
      overall: list ? '' : lv.overall, score: list ? { yes, applicable } : null, doc });
  }
  return out.sort((a, b) => a.number - b.number);
}

const scoreText = r => `${r.score.yes}/${r.score.applicable} Yes`;
const passOf = (r, name) => (r.doc.passes || []).find(p => p.name === name) || null;
const answersOf = (r, p) => r.entries.map(e => str(p?.answers?.[e.short]));
const notComparable = r => r.doc.scope === 'additional_reported_result';
const jbiMatch = rs => rs.filter(r => r.checklist).reduce((n, r) => n + answersOf(r, passOf(r, 'Second assessment')).filter((a, i) => a === r.entries[i].judgement).length, 0) + '/' + rs.filter(r => r.checklist).reduce((n, r) => n + r.entries.length, 0);
// the adjudication as both documents print it: for an appraisal of another result than the earlier passes', why they cannot be compared
const adjudicationOf = r => (notComparable(r) ? `Current appraisal concerns ${str(r.doc.target?.outcome)}; historical passes concerned unavailable failure counts. No independent second pass of the new result is claimed.` : str(r.doc.adjudication));
const methodText = (s, rs, item) => str((s.appraisalMethods?.items || []).find(m => m.item === item)?.text).replace('{jbi_match}', jbiMatch(rs));

// ---- the workbook --------------------------------------------------------------------------------------------------------------
/** A sheet as lib/xlsx-write.mjs takes it: a bold blue header, wrapped bordered cells, judgement colours in the columns named, the first two frozen. */
function sheet(name, heads, rows, widths, colour = []) {
  const all = [heads, ...rows.map(r => r.map(v => (v == null ? '' : typeof v === 'number' ? v : str(v))))];
  const heights = all.map(r => Math.min(409, Math.max(20, Math.max(1, ...r.map((v, c) => str(v).split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(3, (widths[c] || 12) * 0.95))), 0))) * 13 + 8)));
  return { name, rows: all, widths, heights, freeze: { x: 2, y: 1 },
    styleOf: (i, c) => (i === 0 ? { fill: HEAD, bold: true } : colour.includes(c + 1) && FILL[all[i][c]] ? { fill: FILL[all[i][c]] } : {}) };
}

/** The workbook's sheets, as the review's risk-of-bias workbook has them. */
export function robWorkbookSheets(s) {
  const R = robRecord(s), robins = R.filter(r => /robins/i.test(r.tool.id)), rob2 = R.filter(r => r.tool.id === 'rob2'), jbi = R.filter(r => r.checklist);
  const out = [];
  out.push(sheet('Summary', ['ID', 'Study', 'Tool', 'Final overall judgement / JBI score', 'Assessment applies to'],
    R.map(r => [r.number, r.label, r.tool.name, r.overall || scoreText(r), r.doc.target?.outcome || 'Descriptive single-arm clinical series; no causal pre/post efficacy rating']), [6, 22, 18, 30, 75], [4]));
  if (robins.length) {
    const dn = robins[0].entries.map(e => e.label);
    out.push(sheet(robins[0].tool.name, ['ID', 'Study', ...dn, 'Overall', 'Overall rationale', 'Confounders considered', 'Assessed outcome', 'Assessment scope'],
      robins.map(r => [r.number, r.label, ...r.entries.map(e => e.judgement), r.overall, str(r.doc.overall), str(r.doc.confounders), str(r.doc.target?.outcome), r.doc.scope || 'failure']),
      [6, 20, ...dn.map(() => 14), 12, 60, 60, 60, 30], Array.from({ length: dn.length + 1 }, (_, k) => k + 3)));
    out.push(sheet(`${robins[0].tool.name.replace(/ V2$/, '')} support`.replace('ROBINS-I support', 'ROBINS-I support'), ['ID', 'Study', 'Domain', 'Judgement', 'Supporting quote (page)', 'Rationale'],
      robins.flatMap(r => [...r.entries.map(e => [r.number, r.label, e.label, e.judgement, e.support, e.rationale]),
        ...(r.doc.coInterventions?.rationale ? [[r.number, r.label, 'Treatment package / other procedures (context)', '', str(r.doc.coInterventions.support), str(r.doc.coInterventions.rationale)]] : [])]),
      [6, 20, 34, 13, 70, 70], [4]));
  }
  if (rob2.length) out.push(sheet('RoB 2', ['ID', 'Study', 'Domain', 'Judgement', 'Supporting quote (page)', 'Rationale'],
    rob2.flatMap(r => [...r.entries.map(e => [r.number, r.label, e.label, e.judgement, e.support, e.rationale]), [r.number, r.label, 'Overall', r.overall, '', str(r.doc.overall)]]), [6, 20, 34, 15, 70, 70], [4]));
  if (jbi.length) {
    const qs = jbi[0].entries.map(e => e.short);
    out.push(sheet(jbi[0].tool.name, ['ID', 'Study', ...qs, 'Yes count'], jbi.map(r => [r.number, r.label, ...r.entries.map(e => e.judgement), `${r.score.yes}/${r.score.applicable}`]),
      [6, 20, ...qs.map(() => 9), 10], qs.map((_, k) => k + 3)));
    out.push(sheet('JBI support', ['ID', 'Study', 'Item', 'Answer', 'Supporting quote (page)', 'Rationale'], jbi.flatMap(r => r.entries.map(e => [r.number, r.label, e.short, e.judgement, e.support, e.rationale])), [6, 20, 6, 11, 70, 70], [4]));
  }
  out.push(sheet('Second review', ['ID', 'Study', 'Tool', 'Final judgement', 'Historical second AI-assisted pass', 'Final vs second pass', 'Adjudication', 'Historical third AI-assisted pass', 'Final vs third pass'],
    R.map(r => {
      const sp = passOf(r, 'Second assessment'), tp = passOf(r, 'Third assessment');
      if (notComparable(r)) return [r.number, r.label, r.tool.name, r.overall, 'Different target result', 'Not comparable', adjudicationOf(r), '', ''];
      if (r.checklist) {
        const a = answersOf(r, sp);
        return [r.number, r.label, r.tool.name, `${r.score.yes}/${r.score.applicable}`, `${a.filter(x => x === 'Yes').length}/${a.length}`, `Final answers match the second review in ${a.filter((x, i) => x === r.entries[i].judgement).length}/${a.length} items`, str(r.doc.adjudication)];
      }
      return [r.number, r.label, r.tool.name, r.overall, str(sp?.overall), r.overall === sp?.overall ? 'Agree' : 'Disagree', str(r.doc.adjudication), str(tp?.overall), tp ? (r.overall === tp.overall ? 'Agree' : 'Disagree') : ''];
    }), [6, 20, 18, 14, 22, 34, 80, 22, 20], [4, 5, 8]));
  out.push(sheet('Methods', ['Item', 'Description'], (s.appraisalMethods?.items || []).map(m => [m.item, methodText(s, R, m.item)]), [24, 140]));
  out.push(sheet('Signaling questions', ['ID', 'Study', 'Tool', 'Domain', 'Question', 'Question focus', 'Answer', 'Algorithm proposal', 'Final domain', 'Override / triage reason', 'Answer rationale', 'Source support', 'Official form'],
    R.flatMap(r => (r.doc.signalling || []).map(q => { const e = r.entries.find(x => x.short === q.domain) || {};
      return [r.number, r.label, r.tool.name, q.domain, q.question, q.label, q.answer, str(e.algorithm), e.judgement || r.overall, str(e.override), q.rationale, q.support, q.source]; })),
    [6, 22, 18, 10, 10, 46, 10, 18, 18, 65, 90, 80, 65], [8, 9]));
  out.push(sheet('Target results', ['ID', 'Study', 'Tool', 'Comparison', 'Target result and location', 'Effect', 'Time origin', 'Available component coverage', 'Analysis', 'Author verification', 'Assessed outcome', 'Result-selection rationale'],
    R.filter(r => r.doc.target).map(r => { const t = r.doc.target; return [r.number, r.label, r.tool.name, t.comparison, t.reported, t.effect, t.timeOrigin, t.components, t.analysis, str(r.doc.status), t.outcome, t.selection || 'Specified failure outcome for the review comparison.']; }),
    [6, 22, 18, 90, 110, 36, 55, 20, 75, 45, 65, 100]));
  out.push(sheet('Unavailable results', ['ID', 'Study', 'Assessment status', 'Availability detail', 'Reason', 'Search scope', 'Zero events inferred', 'Synthesis scope'],
    robins.filter(notComparable).map(r => { const a = r.doc.availability || {}; return [r.number, r.label, `Failure result unavailable; separate ${a.alternative || 'reported result'} appraisal`, a.detail, a.reason, a.searched, 'No', a.synthesisScope]; }),
    [6, 22, 65, 55, 115, 65, 20, 80]));
  out.push(sheet('Tool selection', ['ID', 'Study', 'Included evidence design', 'Selected instrument', 'Decision', 'Rationale and appraisal scope', 'PDF', 'PDF page', 'Design passage', 'Verification'],
    R.map(r => { const c = r.doc.toolChoice || {}; return [r.number, r.label, c.design, r.tool.name, c.decision, c.reason, c.source, c.page, c.passage, c.verification]; }), [6, 22, 55, 22, 65, 120, 60, 10, 110, 50]));
  out.push(sheet('Author verification', ['ID', 'Study', 'Instrument', 'Reviewer 1', 'Date 1', 'Reviewer 2', 'Date 2', 'Consensus / unresolved issues', 'Status'],
    R.map(r => [r.number, r.label, r.tool.name, '', '', '', '', '', 'Pending']), [6, 22, 22, 25, 16, 25, 16, 90, 20]));
  return out;
}

// ---- the decision log ----------------------------------------------------------------------------------------------------------
let n = 0;
const bid = () => `rr${(n++).toString(36)}`;
const runsOf = (t, o = {}) => [{ t: str(t), ...o }];
const para = (text, { b = false, i = false, sz = null, props = {} } = {}) => ({ id: bid(), type: 'p', styleId: 'Normal', props: { after: 3, ...props }, text: str(text), runs: runsOf(text, { ...(b ? { b: true } : {}), ...(i ? { i: true } : {}), ...(sz ? { sz } : {}) }) });
const labelled = (label, text) => ({ id: bid(), type: 'p', styleId: 'Normal', props: { after: 2 }, text: `${label} ${text}`, runs: [{ t: `${label} `, b: true }, { t: str(text) }] });
// headings in Word's own styles, at the log's sizes: a section 13 pt, a study or check 10.5 pt, kept with what follows
const heading = (text, type) => (type === 'h1'
  ? { id: bid(), type: 'h2', styleId: 'Heading1', props: { before: 12, after: 4, keepNext: true }, text, runs: [{ t: text, b: true, sz: 13 }] }
  : { id: bid(), type: 'h3', styleId: 'Heading2', props: { before: 9, after: 4, keepNext: true }, text, runs: [{ t: text, b: true, sz: 10.5 }] });
const CM = 28.35;
/** A table: column widths in cm, a shaded header repeated on each page, rows kept whole, cells shaded by `fill(row, col, value)`. */
function table(heads, widths, rows, { fill = null, size = 7.5 } = {}) {
  return { id: bid(), type: 'table', text: '', grid: { cols: widths.map(w => w * CM), borders: 'all', keepRows: true, sz: size, jc: 'center',
    rows: [{ header: true, cells: heads.map(h => ({ runs: [{ t: h, b: true }], shade: `#${HEAD}` })) },
      ...rows.map((r, ri) => ({ header: false, cells: r.map((v, c) => { const f = fill ? fill(ri, c, str(v)) : null; return { runs: Array.isArray(v) ? v : runsOf(v), ...(f ? { shade: `#${f}` } : {}) }; }) }))] } };
}

/** The decision log for verification as the Package's blocks. */
export function robRecordBlocks(s) {
  n = 0;
  const R = robRecord(s), L = s.appraisalMethods?.log || {}, out = [];
  const robins = R.filter(r => /robins/i.test(r.tool.id)), rob2 = R.filter(r => r.tool.id === 'rob2'), jbi = R.filter(r => r.checklist);
  const live = R.filter(r => r.overall !== 'Not assessed');
  const statusOf = e => str(e.check?.status) || (e.support ? 'verbatim' : 'no quotation: judgement rests on absence of information');
  const count = pred => live.reduce((k, r) => k + r.entries.filter(pred).length, 0);
  const total = count(() => true), auto = count(e => /^verbatim(?: with marked omission)?$/.test(statusOf(e))), manual = count(e => /confirmed by hand/.test(statusOf(e)));
  const figure = count(e => /checked against the figure/.test(statusOf(e))), absent = count(e => /^no quotation/.test(statusOf(e)));
  const fillOf = v => FILL[v] || null;
  out.push(para(L.title || 'Risk-of-bias assessment: decision log', { b: true, sz: 15, props: { after: 2 } }));
  if (L.subtitle) out.push(para(L.subtitle, { i: true, sz: 8.5, props: { after: 8 } }));
  out.push(heading('1. How to use this log', 'h1'));
  for (const t of L.intro || []) out.push(para(t.replace('{total}', total).replace('{auto}', auto).replace('{manual}', manual).replace('{figure}', figure).replace('{absent}', absent), { props: { after: 3, ind: 8.5 } }));
  out.push(heading('2. Assessment framework and decision rules', 'h1'));
  for (const k of L.framework || []) { const t = methodText(s, R, k); if (t) out.push(labelled(`${k}.`, t)); }
  for (const x of L.notes || []) out.push(labelled(x.label, x.text));
  out.push(heading('3. Priority checks', 'h1'));
  out.push(heading('3.1 Results at a glance', 'h2'));
  out.push(table(['ID', 'Study', 'Tool', 'Final', 'Second assessment', 'Third assessment', 'Items differing from second', 'Absence-of-information items', 'PDF'], [1.0, 3.0, 2.4, 2.3, 2.4, 2.4, 1.8, 2.2, 9.0],
    R.map(r => {
      const sp = passOf(r, 'Second assessment'), tp = passOf(r, 'Third assessment'), a = answersOf(r, sp);
      const diff = notComparable(r) ? 'Not comparable' : String(r.entries.filter((e, i) => e.judgement !== a[i]).length);
      return [String(r.number), r.label, r.tool.name, r.overall || scoreText(r), notComparable(r) ? 'Different target result' : sp?.overall || `${a.filter(x => x === 'Yes').length}/${a.length} Yes`,
        notComparable(r) ? 'Different target result' : str(tp?.overall), diff, String(r.entries.filter(e => /^no quotation/.test(statusOf(e))).length), r.pdf];
    }), { fill: (ri, c, v) => (c >= 3 && c <= 5 ? fillOf(v) : c === 6 && v !== '0' && v !== 'Not comparable' ? FLAG : null) }));
  out.push(heading('3.2 Current judgments differing from a historical AI pass', 'h2'));
  out.push(table(['ID', 'Study', 'Final', 'Second', "Second assessor's reason", 'Adjudication'], [1.0, 3.0, 1.8, 1.8, 8.4, 10.5],
    robins.filter(r => r.overall !== 'Not assessed' && !notComparable(r) && r.overall !== passOf(r, 'Second assessment')?.overall)
      .map(r => [String(r.number), r.label, r.overall, str(passOf(r, 'Second assessment')?.overall), str(passOf(r, 'Second assessment')?.reason), adjudicationOf(r)]),
    { fill: (ri, c, v) => (c === 2 || c === 3 ? fillOf(v) : null) }));
  out.push(heading('3.3 Domain-level differences that remain (ROBINS-I and RoB 2)', 'h2'));
  out.push(para('The final judgement is the one used; the overall result is unaffected unless the domain is the most severe one.', { i: true, sz: 8 }));
  out.push(table(['ID', 'Study', 'Domain', 'Final', 'Second', 'Sets overall', 'Reason for final judgement'], [1.0, 2.8, 4.6, 1.8, 1.8, 1.4, 13.1],
    [...robins, ...rob2].filter(r => r.overall !== 'Not assessed' && !notComparable(r)).flatMap(r => { const a = answersOf(r, passOf(r, 'Second assessment'));
      return r.entries.map((e, i) => [e, a[i]]).filter(([e, x]) => e.judgement !== x).map(([e, x]) => [String(r.number), r.label, e.label, e.judgement, x, e.judgement === r.overall ? 'yes' : 'no', e.rationale]); }),
    { fill: (ri, c, v) => (c === 3 || c === 4 ? fillOf(v) : null) }));
  out.push(heading('3.4 JBI items that differ between the two assessments', 'h2'));
  out.push(table(['ID', 'Study', 'Item', 'Final', 'Second', 'Reason for final answer'], [1.0, 3.0, 1.0, 1.8, 1.8, 17.9],
    jbi.flatMap(r => { const a = answersOf(r, passOf(r, 'Second assessment')); return r.entries.map((e, i) => [e, a[i]]).filter(([e, x]) => e.judgement !== x).map(([e, x]) => [String(r.number), r.label, e.short, e.judgement, x, e.rationale]); }),
    { fill: (ri, c, v) => (c === 3 || c === 4 ? fillOf(v) : null) }));
  out.push(heading('3.5 Judgements resting on the absence of information', 'h2'));
  out.push(para('No quotation can support these; confirm by searching the full text (methods, results, tables and limitations).', { i: true, sz: 8 }));
  out.push(table(['ID', 'Study', 'Domain / item', 'Judgement', 'As recorded', 'Reason'], [1.0, 2.8, 4.2, 2.0, 4.6, 11.9],
    live.flatMap(r => r.entries.filter(e => /^no quotation/.test(statusOf(e))).map(e => [String(r.number), r.label, e.label, e.judgement, e.support, e.rationale])),
    { fill: (ri, c, v) => (c === 3 ? fillOf(v) : null) }));
  // the full record of each study, by instrument
  const block = (r, label) => {
    const d = r.doc, sp = passOf(r, 'Second assessment'), tp = passOf(r, 'Third assessment');
    out.push(heading(`ID ${r.number}  ${r.label}  (${label})`, 'h2'));
    const head = [{ t: 'PDF: ', b: true }, { t: r.pdf }], line = { id: bid(), type: 'p', styleId: 'Normal', props: { after: 2 }, text: '', runs: head };
    out.push(line);
    if (d.toolChoice) out.push(labelled('Tool selection:', `${str(d.toolChoice.design)}. ${str(d.toolChoice.reason)}`));
    if (d.target) out.push(labelled('Assessed result:', `${str(d.target.outcome)}. ${str(d.target.reported)}`));
    if (notComparable(r)) { out.push(labelled('Scope:', `Additional reported-result appraisal. Failure counts remain unavailable: ${str(d.availability?.reason)}`)); out.push(labelled('Result selection:', str(d.target?.selection))); }
    if (r.overall === 'Not assessed') { out.push(labelled('Status:', 'Not assessed: target outcome not reported as usable arm-level counts.')); out.push(labelled('Availability:', str(d.availability?.reason))); line.text = head.map(x => x.t).join(''); return; }
    // the line under the heading: the PDF, then the overall judgement and the earlier passes' (a checklist's score and agreement)
    if (!r.checklist) {
      head.push({ t: '    Overall: ', b: true }, { t: r.overall });
      if (!notComparable(r)) { head.push({ t: '    Second assessment: ', b: true }, { t: str(sp?.overall) }); if (tp) head.push({ t: '    Third assessment: ', b: true }, { t: str(tp.overall) }); }
    } else {
      const a = answersOf(r, sp);
      head.push({ t: '    Score: ', b: true }, { t: scoreText(r) }, { t: '    Agreement: ', b: true }, { t: `Final answers match the second review in ${a.filter((x, k) => x === r.entries[k].judgement).length}/${a.length} items` });
    }
    line.text = head.map(x => x.t).join('');
    if (d.confounders) out.push(labelled('Confounders considered:', d.confounders));
    if (d.coInterventions?.rationale) out.push(labelled('Treatment package and other procedures (context):', `${d.coInterventions.rationale} Source: ${str(d.coInterventions.support)}`));
    if (d.overall) out.push(labelled('Overall reasoning:', d.overall));
    if (!notComparable(r)) { if (sp?.reason) out.push(labelled("Second assessor's key reason:", sp.reason)); if (tp?.reason) out.push(labelled("Third assessor's key reason:", tp.reason)); }
    if (adjudicationOf(r)) out.push(labelled('Adjudication:', adjudicationOf(r)));
    const a = answersOf(r, sp), flags = r.entries.map((e, i) => !notComparable(r) && e.judgement !== a[i]);
    out.push(table([r.checklist ? 'Item' : 'Domain', 'Final', 'Second', 'Supporting text (as cited)', 'PDF p.', 'Quotation check', 'Reason', 'Check'],
      r.checklist ? [1.0, 1.5, 1.5, 8.2, 1.1, 2.4, 9.5, 1.3] : [3.2, 1.7, 1.7, 7.2, 1.1, 2.4, 7.9, 1.3],
      r.entries.map((e, i) => [r.checklist ? e.short : e.label, e.judgement, notComparable(r) ? 'Not independently reviewed' : a[i], e.support, (e.check?.pages?.length ? e.check.pages : e.pages).join(', '), statusOf(e), e.rationale, '']),
      { size: 7, fill: (ri, c, v) => (c === 1 || c === 2 ? (flags[ri] ? FLAG : fillOf(v)) : null) }));
  };
  const sec = (k, list, label, no) => {
    if (!list.length) return;
    out.push(heading(`${no}. ${L.sections?.[list[0].tool.id] || list[0].tool.name} (n = ${list.length})`, 'h1'));
    if (L.items?.[list[0].tool.id]) out.push(para(L.items[list[0].tool.id], { sz: 8 }));
    for (const r of list) block(r, label);
  };
  sec('robins', robins, robins[0]?.tool.name, 4); sec('rob2', rob2, 'RoB 2', 5); sec('jbi', jbi, jbi[0]?.tool.name, 6);
  return out;
}

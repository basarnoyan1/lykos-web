// RevMan 5 review files (.rm5, Cochrane's XML) in and out (plan §4.15f).
//
// A review file holds what the app already keeps in four places: the studies and their references (Library), the characteristics of each
// included study (Extraction), the risk-of-bias judgements (Appraisal, RoB 1) and the study-level data of each comparison (Extraction inputs
// per outcome). `readRevman` turns the XML into one neutral document, `revmanRecords` gives its references to the Library's importer,
// `applyRevman` writes the rest into a project, `revmanFromState` builds the document from a project and `writeRevman` prints it.
//
// What is written is the study-level input only (events and totals, means, SDs and totals). RevMan recomputes weights, pooled effects and
// heterogeneity when it opens a file, and so does this app: neither file carries the other's statistics. Generic inverse-variance and
// reported-estimate outcomes have no counterpart here and are counted as skipped, never converted.
//
// The element and attribute names are those of RevMan 5.4 files as documented by Cochrane; the reader looks an element up wherever it sits and
// accepts a missing attribute, so it takes files from other 5.x versions. No file written here has been opened in RevMan itself (plan §4.15f).
import { parseXml } from './xml.mjs';
import { importKey, authorList, familyName } from './bib.mjs';
import { libraryIndex, importReferences } from './search-library.mjs';
import { isIncluded, finalDecision, applyDecision } from './screen.mjs';
import { setManualStateValue } from './fields.mjs';
import { measureOf, inputFields } from './effect-measures.mjs';
import { PRIMARY, outcomes, shownOutcomes, addOutcome, setOutcomeMeasure, fieldFor } from './outcomes.mjs';
import { studyRows } from './analysis-inputs.mjs';
import { allTools } from '../schema.mjs';
import { setAnswer, STUDY } from './rob-review.mjs';

export const sniffRevman = t => /<COCHRANE_REVIEW[\s>]/.test(String(t).slice(0, 6000));

// ---- reading ------------------------------------------------------------------------------------------------------------------
const kids = (el, name) => (el ? el.children.filter(c => c.nodeName === name) : []);
const first = (el, name) => kids(el, name)[0] || null;
const deep = (el, name) => (el ? el.getElementsByTagName(name) : []);
const num = v => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const squash = v => String(v ?? '').replace(/\s+/g, ' ').trim();
/** A rich-text element (<P> paragraphs, links) as plain text, paragraphs separated by a blank line. */
function rich(el) {
  if (!el) return '';
  const ps = kids(el, 'P');
  return (ps.length ? ps.map(p => squash(p.textContent)) : [squash(el.textContent)]).filter(Boolean).join('\n\n');
}

function referenceOf(ref) {
  const id = type => deep(ref, 'IDENTIFIER').find(i => i.getAttribute('TYPE') === type)?.getAttribute('VALUE') || '';
  const source = squash(first(ref, 'SO')?.textContent);
  return { authors: authorList(squash(first(ref, 'AU')?.textContent)), title: squash(first(ref, 'TI')?.textContent), journal: source,
    year: squash(first(ref, 'YR')?.textContent), volume: squash(first(ref, 'VL')?.textContent), issue: squash(first(ref, 'NO')?.textContent),
    pages: squash(first(ref, 'PG')?.textContent), doi: id('DOI'), pmid: id('PUBMED'), primary: ref.getAttribute('PRIMARY') === 'YES' };
}

/** A review file as a neutral document; throws when the text is not a RevMan review. */
export function readRevman(text) {
  const doc = parseXml(String(text ?? '').replace(/^﻿/, ''));
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'COCHRANE_REVIEW') throw new Error('Not a RevMan review file');
  const studies = [], byId = new Map();
  for (const [group, included] of [['INCLUDED_STUDIES', true], ['EXCLUDED_STUDIES', false]]) {
    for (const st of deep(first(first(first(root, 'STUDIES_AND_REFERENCES'), 'STUDIES'), group), 'STUDY')) {
      const refs = kids(st, 'REFERENCE').map(referenceOf);
      const e = { id: st.getAttribute('ID') || `STD-${studies.length + 1}`, name: st.getAttribute('NAME') || '', year: st.getAttribute('YEAR') || '',
        included, reason: '', refs, char: {}, bias: {} };
      studies.push(e); byId.set(e.id, e);
    }
  }
  for (const c of deep(root, 'INCLUDED_CHAR')) {
    const e = byId.get(c.getAttribute('STUDY_ID')); if (!e) continue;
    e.char = { methods: rich(first(c, 'CHAR_METHODS')), participants: rich(first(c, 'CHAR_PARTICIPANTS')), interventions: rich(first(c, 'CHAR_INTERVENTIONS')),
      outcomes: rich(first(c, 'CHAR_OUTCOMES')), notes: rich(first(c, 'CHAR_NOTES')) };
  }
  for (const c of deep(root, 'EXCLUDED_CHAR')) {
    const e = byId.get(c.getAttribute('STUDY_ID')); if (e) e.reason = rich(first(c, 'CHAR_REASON_FOR_EXCLUSION'));
  }
  const biasItems = deep(root, 'QUALITY_ITEM').map((q, i) => {
    const item = { id: q.getAttribute('ID') || `QIT-${i + 1}`, name: squash(first(q, 'NAME')?.textContent), description: rich(first(q, 'DESCRIPTION')) };
    for (const d of deep(q, 'QUALITY_ITEM_DATA_ENTRY')) {
      const e = byId.get(d.getAttribute('STUDY_ID')); if (!e) continue;
      e.bias[item.id] = { result: d.getAttribute('RESULT') || 'UNKNOWN', support: rich(first(d, 'DESCRIPTION')) };
    }
    return item;
  });
  const comparisons = deep(root, 'COMPARISON').map((c, i) => ({ id: c.getAttribute('ID') || `CMP-${i + 1}`, name: squash(first(c, 'NAME')?.textContent),
    outcomes: c.children.filter(o => /^(DICH|CONT|IV)_OUTCOME$/.test(o.nodeName)).map((o, j) => {
      const kind = o.nodeName.startsWith('DICH') ? 'dich' : o.nodeName.startsWith('CONT') ? 'cont' : 'iv';
      const row = d => kind === 'dich' ? { study: d.getAttribute('STUDY_ID'), events1: num(d.getAttribute('EVENTS_1')), total1: num(d.getAttribute('TOTAL_1')),
        events2: num(d.getAttribute('EVENTS_2')), total2: num(d.getAttribute('TOTAL_2')) }
        : kind === 'cont' ? { study: d.getAttribute('STUDY_ID'), mean1: num(d.getAttribute('MEAN_1')), sd1: num(d.getAttribute('SD_1')), total1: num(d.getAttribute('TOTAL_1')),
          mean2: num(d.getAttribute('MEAN_2')), sd2: num(d.getAttribute('SD_2')), total2: num(d.getAttribute('TOTAL_2')) }
        : { study: d.getAttribute('STUDY_ID'), effect: num(d.getAttribute('EFFECT_SIZE')), se: num(d.getAttribute('SE')) };
      return { id: o.getAttribute('ID') || `${c.getAttribute('ID') || i + 1}.${j + 1}`, name: squash(first(o, 'NAME')?.textContent), kind,
        measure: o.getAttribute('EFFECT_MEASURE') || (kind === 'cont' ? 'MD' : 'RR'), label1: squash(first(o, 'GROUP_LABEL_1')?.textContent),
        label2: squash(first(o, 'GROUP_LABEL_2')?.textContent), graph1: squash(first(o, 'GRAPH_LABEL_1')?.textContent), graph2: squash(first(o, 'GRAPH_LABEL_2')?.textContent),
        data: kids(o, `${kind.toUpperCase()}_DATA`).map(row) };
    }) }));
  return { title: squash(first(first(root, 'COVER_SHEET'), 'TITLE')?.textContent), type: root.getAttribute('TYPE') || 'INTERVENTION', version: root.getAttribute('REVMAN_VERSION') || '',
    studies, biasItems, comparisons };
}

// ---- into the project -----------------------------------------------------------------------------------------------------------
const nameOf = e => e.name || [familyName(e.refs[0]?.authors?.[0] || ''), e.refs[0]?.year || e.year].filter(Boolean).join(' ') || e.id;

/** The Library's records for a document's references, one per study (its primary reference, else its first), labeled as the review names the study. */
export function revmanRecords(doc) {
  return doc.studies.filter(e => e.refs.length).map(e => {
    const r = e.refs.find(x => x.primary) || e.refs[0], year = r.year || e.year, authors = r.authors;
    const key = importKey({ doi: r.doi, pmid: r.pmid, title: r.title, year, authors });
    return { key, id: key, title: r.title, authors, year: String(year || ''), journal: r.journal, volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, pmid: r.pmid,
      database: 'RevMan', label: nameOf(e), raw: [] };
  });
}

/** RevMan's quality item names against RoB 1's seven domains. */
const ROB1 = [[/random sequence|sequence generation/i, 'd1'], [/allocation conceal/i, 'd2'], [/blinding of participants|performance bias/i, 'd3'],
  [/blinding of outcome|detection bias/i, 'd4'], [/incomplete outcome|attrition/i, 'd5'], [/selective|reporting bias/i, 'd6'], [/other bias/i, 'd7']];
export const robDomainOf = name => ROB1.find(([re]) => re.test(String(name)))?.[1] || null;
const LEVEL = { YES: 'Low', NO: 'High', UNKNOWN: 'Unclear' };
const RESULT = { Low: 'YES', High: 'NO', Unclear: 'UNKNOWN' };
const CHAR_FIELDS = [['methods', 'design'], ['participants', 'population'], ['interventions', 'intervention'], ['outcomes', 'outcome']];
const MEASURE = { RR: 'RR', OR: 'OR', PETO: 'OR', RD: 'RD', MD: 'MD', SMD: 'SMD' };

/**
 * Writes a document into a project: the references into the Library, the included studies as included at full text and the excluded ones with their
 * reasons, the characteristics as extracted values, the risk of bias as RoB 1 judgements and each dichotomous or continuous outcome's data as the
 * outcome's inputs. A value the project already holds is replaced. Answers counts: { studies, excluded, characteristics, bias, outcomes, data, skipped }.
 */
export function applyRevman(st, doc, { fileName = '', by = 'RevMan import', at = new Date().toISOString() } = {}) {
  st.papers = st.papers || [];
  importReferences(st, revmanRecords(doc), fileName, { at });
  const index = libraryIndex(st.papers), paperOf = new Map(), out = { studies: 0, excluded: 0, characteristics: 0, bias: 0, outcomes: 0, data: 0, skipped: [] };
  for (const e of doc.studies) {
    const rec = revmanRecords({ studies: [e] })[0];
    const p = rec && index.find(rec);
    if (!p) { out.skipped.push(`${nameOf(e)}: no reference`); continue; }
    paperOf.set(e.id, p);
    if (e.included) { applyDecision(st, 'ft', p.id, 'include', { by }); out.studies++; }
    else { applyDecision(st, 'ft', p.id, 'exclude', { reason: e.reason || 'Excluded in the RevMan review', by }); out.excluded++; }
    for (const [from, field] of CHAR_FIELDS) if (e.char[from] && setManualStateValue(st, p.id, field, e.char[from])) out.characteristics++;
  }
  // risk of bias: RoB 1's seven domains; a quality item with another name is counted, not guessed
  const tools = allTools(st), rob1 = tools.find(t => t.id === 'rob1'), toolIds = tools.map(t => t.id);
  const domainOf = new Map(doc.biasItems.map(q => [q.id, robDomainOf(q.name)]));
  for (const q of doc.biasItems) if (!domainOf.get(q.id)) out.skipped.push(`Risk of bias item "${q.name}": not a RoB 1 domain`);
  if (rob1) for (const e of doc.studies) {
    const p = paperOf.get(e.id); if (!p || !e.included) continue;
    let any = false;
    for (const [qid, b] of Object.entries(e.bias)) {
      const domain = domainOf.get(qid), value = LEVEL[b.result];
      if (!domain || !value) continue;
      setAnswer(st, { paperId: p.id, toolId: 'rob1', level: STUDY, who: 'a', domain, value, toolIds }); any = true; out.bias++;
      if (b.support) {
        const text = `${rob1.name} ${rob1.domains.find(d => d.id === domain)?.short}: ${value} — "${b.support}"`;
        if (!(st.notes || []).some(n => n.paper === p.id && n.text === text)) st.notes = [...(st.notes || []), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, paper: p.id, kind: 'quote', text, page: '', extractor: `import:${by}`, verification: 'verified', at }];
      }
    }
    if (any) st.appraisalByStudy = { ...(st.appraisalByStudy || {}), [p.id]: 'rob1' };
  }
  // data: one outcome of the project per outcome of the file
  for (const cmp of doc.comparisons) for (const o of cmp.outcomes) {
    const measure = MEASURE[o.measure];
    if (o.kind === 'iv' || !measure) { out.skipped.push(`Outcome "${o.name}": ${o.kind === 'iv' ? 'generic inverse variance' : o.measure} has no counterpart`); continue; }
    const id = ownOutcome(st, o.name || cmp.name, measure);
    out.outcomes++;
    for (const d of o.data) {
      const p = paperOf.get(d.study); if (!p) { out.skipped.push(`Outcome "${o.name}": study ${d.study} not in the file's studies`); continue; }
      const given = o.kind === 'dich' ? [d.events1, d.total1, d.events2, d.total2] : [d.mean1, d.sd1, d.total1, d.mean2, d.sd2, d.total2];
      inputFields(measure).forEach((f, i) => { if (given[i] != null && setManualStateValue(st, p.id, fieldFor(f, id), String(given[i]), { type: /^(n|events)(_|$)/.test(f) ? 'integer' : 'number' })) out.data++; });
    }
  }
  return out;
}

/** The project's outcome for a name and measure: the one already there, the unused primary, or a new one. */
function ownOutcome(st, name, measure) {
  const have = outcomes(st).find(o => o.name.toLowerCase() === String(name).toLowerCase());
  if (have) { setOutcomeMeasure(st, have.id, measure); return have.id; }
  const primary = (st.outcomes || []).find(o => o.id === PRIMARY), hasPrimaryValues = Object.keys(st.values || {}).some(k => /:(events_t|n_t|mean_t)$/.test(k));
  if (!hasPrimaryValues && !primary?.named && !st.outcomes?.some(o => o.id !== PRIMARY)) {
    st.outcomes = [{ ...(primary || {}), id: PRIMARY, name: String(name).trim() || 'Outcome 1', named: true }];
    setOutcomeMeasure(st, PRIMARY, measure);
    return PRIMARY;
  }
  return addOutcome(st, name, measure);
}

// ---- out of the project -----------------------------------------------------------------------------------------------------------
const slug = s => String(s).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'x';

/** The project as a neutral document, with what could not be carried over: `skipped` (strings). Included studies are those the screening included. */
export function revmanFromState(s) {
  const skipped = [], ids = new Map(), used = new Set();
  const idFor = p => { if (!ids.has(p.id)) { let id = `STD-${slug(p.label || p.id)}`, n = 2; while (used.has(id)) id = `STD-${slug(p.label || p.id)}-${n++}`; used.add(id); ids.set(p.id, id); } return ids.get(p.id); };
  const val = (p, f) => { const v = s.values?.[`${p.id}:${f}`]; return v && v.availability !== 'not_found' ? String(v.reported_value ?? v.normalized_value ?? '').trim() : ''; };
  const papers = s.papers || [], inc = papers.filter(p => isIncluded(s, p.id));
  const exc = papers.filter(p => s.fulltext?.[p.id]?.decision === 'exclude');
  const ref = p => ({ authors: authorList(p.authors), title: p.title || '', journal: p.journal || '', year: String(p.year || ''), volume: p.volume || '', issue: p.issue || '', pages: p.pages || '', doi: p.doi || '', pmid: p.pmid || '', primary: true });
  const studies = [...inc.map(p => ({ id: idFor(p), name: p.label || p.id, year: String(p.year || ''), included: true, reason: '', refs: [ref(p)],
    char: { methods: val(p, 'design'), participants: val(p, 'population'), interventions: [val(p, 'intervention') && `Intervention: ${val(p, 'intervention')}`, val(p, 'comparator') && `Comparator: ${val(p, 'comparator')}`].filter(Boolean).join('\n\n'),
      outcomes: val(p, 'outcome'), notes: '' }, bias: {} })),
    ...exc.map(p => ({ id: idFor(p), name: p.label || p.id, year: String(p.year || ''), included: false, reason: s.fulltext[p.id].reason || '', refs: [ref(p)], char: {}, bias: {} }))];
  // risk of bias: RoB 1 only; another instrument's judgements are counted
  const biasItems = (allTools(s).find(t => t.id === 'rob1')?.domains || []).map((d, i) => ({ id: `QIT-${String(i + 1).padStart(2, '0')}`, domain: d.id, name: d.label, description: '' }));
  const byPaper = new Map(inc.map(p => [p.id, p]));
  let other = 0;
  for (const [pid, rec] of Object.entries(s.assessments || {})) {
    const p = byPaper.get(pid); if (!p) continue;
    const e = studies.find(x => x.id === ids.get(pid));
    for (const [tool, r] of Object.entries(rec || {})) {
      if (tool !== 'rob1') { if (r && typeof r === 'object' && Object.keys(r).length) other++; continue; }
      const answers = r;   // s.assessments keeps the settled answers per instrument (lib/rob-review.mjs)
      for (const item of biasItems) if (RESULT[answers?.[item.domain]]) e.bias[item.id] = { result: RESULT[answers[item.domain]], support: '' };
    }
  }
  if (other) skipped.push(`${other} ${other === 1 ? 'study' : 'studies'} with risk of bias in another instrument than RoB 1 (RevMan's tables)`);
  const rows = [];
  for (const o of shownOutcomes(s)) {
    const m = measureOf(o.measure), kind = m.family === 'binary' ? 'dich' : m.family === 'continuous' ? 'cont' : null;
    if (!kind) { skipped.push(`Outcome "${o.name}": ${m.label} has no counterpart in a RevMan data table`); continue; }
    const data = []; let dropped = 0;
    for (const p of inc) for (const r of studyRows(s, p, o.measure, o.id)) {
      const v = r.values;
      if (!v || v.some(x => x == null || !Number.isFinite(x))) { dropped++; continue; }
      data.push(kind === 'dich' ? { study: idFor(p), events1: v[0], total1: v[1], events2: v[2], total2: v[3] }
        : { study: idFor(p), mean1: v[0], sd1: v[1], total1: v[2], mean2: v[3], sd2: v[4], total2: v[5] });
    }
    if (dropped) skipped.push(`Outcome "${o.name}": ${dropped} ${dropped === 1 ? 'study' : 'studies'} without complete data left out`);
    if (data.length) rows.push({ id: `o${rows.length + 1}`, name: o.name, kind, measure: m.id, label1: 'Intervention', label2: 'Comparator', graph1: 'Favors intervention', graph2: 'Favors comparator', data });
  }
  const pico = s.protocol?.pico || {};
  const name = [pico.intervention, pico.comparator].filter(Boolean).join(' versus ') || 'Intervention versus comparator';
  return { doc: { title: s.protocol?.title || s.paper?.title || s.project?.name || 'Review', type: 'INTERVENTION', version: '5.4', studies, biasItems,
    comparisons: rows.length ? [{ id: 'CMP-001', name, outcomes: rows }] : [] }, skipped };
}

// ---- printing --------------------------------------------------------------------------------------------------------------------
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = o => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const tag = (name, a, inner = '') => `<${name}${attrs(a)}>${inner}</${name}>`;
const paras = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => `<P>${esc(x)}</P>`).join('');
const rich2 = (name, t, a = {}) => (t ? tag(name, a, paras(t)) : '');

/** The document as RevMan 5 XML. */
export function writeRevman(doc, { at = new Date() } = {}) {
  const mod = at.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000'), M = { MODIFIED: mod, MODIFIED_BY: '' };
  const refXml = r => tag('REFERENCE', { TYPE: 'JOURNAL_ARTICLE', PRIMARY: r.primary ? 'YES' : 'NO' },
    tag('AU', {}, esc(r.authors.join(', '))) + tag('TI', {}, esc(r.title)) + tag('SO', {}, esc(r.journal)) + (r.year ? tag('YR', {}, esc(r.year)) : '')
    + (r.volume ? tag('VL', {}, esc(r.volume)) : '') + (r.issue ? tag('NO', {}, esc(r.issue)) : '') + (r.pages ? tag('PG', {}, esc(r.pages)) : '')
    + ((r.doi || r.pmid) ? tag('IDENTIFIERS', {}, (r.pmid ? tag('IDENTIFIER', { MODIFIED: mod, TYPE: 'PUBMED', VALUE: r.pmid }) : '') + (r.doi ? tag('IDENTIFIER', { MODIFIED: mod, TYPE: 'DOI', VALUE: r.doi }) : '')) : ''));
  const study = e => tag('STUDY', { ID: e.id, NAME: e.name, YEAR: e.year, DATA_SOURCE: 'PUB', ...M }, e.refs.map(refXml).join(''));
  const inc = doc.studies.filter(e => e.included), exc = doc.studies.filter(e => !e.included);
  const incChar = inc.map(e => tag('INCLUDED_CHAR', { STUDY_ID: e.id, ...M }, rich2('CHAR_METHODS', e.char.methods, M) + rich2('CHAR_PARTICIPANTS', e.char.participants, M)
    + rich2('CHAR_INTERVENTIONS', e.char.interventions, M) + rich2('CHAR_OUTCOMES', e.char.outcomes, M) + rich2('CHAR_NOTES', e.char.notes, M))).join('');
  const excChar = exc.map(e => tag('EXCLUDED_CHAR', { STUDY_ID: e.id, ...M }, rich2('CHAR_REASON_FOR_EXCLUSION', e.reason, M))).join('');
  const quality = doc.biasItems.length ? tag('QUALITY_ITEMS', M, doc.biasItems.map((q, i) => tag('QUALITY_ITEM', { ID: q.id, NO: i + 1 },
    tag('NAME', {}, esc(q.name)) + tag('DESCRIPTION', {}, paras(q.description || q.name)) + tag('QUALITY_ITEM_DATA', {}, inc.filter(e => e.bias[q.id]).map(e =>
      tag('QUALITY_ITEM_DATA_ENTRY', { STUDY_ID: e.id, RESULT: e.bias[q.id].result, GROUP_ID: '', ...M }, e.bias[q.id].support ? tag('DESCRIPTION', {}, paras(e.bias[q.id].support)) : '')).join('')))).join('')) : '';
  const outcome = (o, ci, oi) => {
    const dich = o.kind === 'dich', name = dich ? 'DICH' : 'CONT';
    const head = { CI_START: '', EFFECT_MEASURE: o.measure === 'OR' ? 'OR' : o.measure, ID: `CMP-${String(ci + 1).padStart(3, '0')}.${String(oi + 1).padStart(2, '0')}`, NO: oi + 1, RANDOM: 'YES', STUDIES: o.data.length, ...M };
    if (!dich) head.CONTINUOUS = 'YES';
    const rows = o.data.map((d, i) => tag(`${name}_DATA`, dich ? { EVENTS_1: d.events1, EVENTS_2: d.events2, ORDER: i + 1, STUDY_ID: d.study, TOTAL_1: d.total1, TOTAL_2: d.total2 }
      : { MEAN_1: d.mean1, MEAN_2: d.mean2, ORDER: i + 1, SD_1: d.sd1, SD_2: d.sd2, STUDY_ID: d.study, TOTAL_1: d.total1, TOTAL_2: d.total2 })).join('');
    return tag(`${name}_OUTCOME`, head, tag('NAME', {}, esc(o.name)) + tag('GROUP_LABEL_1', {}, esc(o.label1)) + tag('GROUP_LABEL_2', {}, esc(o.label2))
      + tag('GRAPH_LABEL_1', {}, esc(o.graph1)) + tag('GRAPH_LABEL_2', {}, esc(o.graph2)) + rows);
  };
  const comparisons = doc.comparisons.map((c, ci) => tag('COMPARISON', { ID: `CMP-${String(ci + 1).padStart(3, '0')}`, NO: ci + 1, ...M }, tag('NAME', {}, esc(c.name)) + c.outcomes.map((o, oi) => outcome(o, ci, oi)).join(''))).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE COCHRANE_REVIEW SYSTEM "rm5.dtd">\n`
    + tag('COCHRANE_REVIEW', { ID: '', MODIFIED: mod, MODIFIED_BY: '', REVMAN_VERSION: '5.4', TYPE: doc.type || 'INTERVENTION', VERSION: '5.4' },
      tag('COVER_SHEET', M, tag('TITLE', {}, esc(doc.title)))
      + tag('STUDIES_AND_REFERENCES', M, tag('STUDIES', M, tag('INCLUDED_STUDIES', {}, inc.map(study).join('')) + (exc.length ? tag('EXCLUDED_STUDIES', {}, exc.map(study).join('')) : '')))
      + tag('CHARACTERISTICS_OF_STUDIES', M, tag('CHARACTERISTICS_OF_INCLUDED_STUDIES', M, incChar) + (exc.length ? tag('CHARACTERISTICS_OF_EXCLUDED_STUDIES', M, excChar) : ''))
      + quality + tag('ANALYSES_AND_DATA', M, comparisons)) + '\n';
}

// Review of a manuscript version (review batch 12 Task 22, Batch 13 item 7): the questions the author asks of every new version, each a
// rule the app runs or one bounded model prompt. Token discipline: a paragraph is sent once per version per category (a unit whose text
// was reviewed in the last run is skipped); a section request carries only its own paragraphs and the records they cite; the outline
// request carries 240 characters per paragraph; every prompt returns JSON findings and is told not to report what is correct.
// Pure: the view sends the requests and keeps the runs (state.reviewRuns).
import { classifyStructure } from './manuscript-structure.mjs';
import { citations, hashText } from './manuscript.mjs';
import { checkManuscript } from './manuscript-checks.mjs';
import { sectionCheck, countsAgainstProfile } from './submission-checks.mjs';
import { unsupported } from './numbers.mjs';
import { studyLabel } from './supplement-import.mjs';
import { REVIEW_REFERENCES, REVIEW_MEANING, REVIEW_SECTIONS, REVIEW_NUMBERS } from './prompts.mjs';

export const CATEGORIES = Object.freeze([
  { id: 'citations', label: 'Citations resolve', kind: 'rule', scope: 'document' },
  { id: 'reference-list', label: 'Reference records complete', kind: 'rule', scope: 'document' },
  { id: 'required', label: 'Required sections', kind: 'rule', scope: 'document' },
  { id: 'limits', label: 'Journal limits', kind: 'rule', scope: 'document' },
  { id: 'facts', label: 'Numbers in the project\'s results', kind: 'rule', scope: 'document' },
  { id: 'references', label: 'References support their claims', kind: 'model', prompt: REVIEW_REFERENCES, scope: 'section' },
  { id: 'sections', label: 'Text in the right section', kind: 'model', prompt: REVIEW_SECTIONS, scope: 'document' },
  { id: 'numbers', label: 'Numbers agree', kind: 'model', prompt: REVIEW_NUMBERS, scope: 'section' },
  { id: 'meaning', label: 'Meaning', kind: 'model', prompt: REVIEW_MEANING, scope: 'paragraph' },
]);
export const categoryById = id => CATEGORIES.find(c => c.id === id) || null;
const SEV = new Set(['error', 'warn', 'note']);
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const paragraph = b => b && b.type === 'p' && clip(b.text, 1).length > 0;
const isHead = b => /^h[1-3]$/.test(b?.type || '');
/** The sections that hold text: `{ heading, role, blocks }`, the references section left out (it is checked by its rule). */
function sectionsOf(blocks, roles) {
  const out = []; let cur = null;
  blocks.forEach((b, i) => {
    if (isHead(b)) { cur = { heading: clip(b.text, 80), role: roles[i], blocks: [] }; out.push(cur); }
    else if (cur && paragraph(b) && roles[i] !== 'references') cur.blocks.push(b);
  });
  return out.filter(s => s.blocks.length);
}
const fenced = (label, text) => `<<${label}>>\n${text}\n<</${label}>>`;
const unit = (b, library) => `[${b.id}] ${b.text}${citations(b.text).map(c => {
  const p = library.find(x => x.key === c.key);
  return p ? `\n  @${c.key}: ${clip(p.title, 160)} (${clip(p.journal, 40)} ${p.year || ''})` : `\n  @${c.key}: no record`;
}).join('')}`;

/** The requests a model category needs: `[{ key, blockIds, messages }]`; a unit reviewed on the last run is skipped. */
export function requestsFor(cat, { blocks = [], roles = classifyStructure(blocks), library = [], previous = null, journal = '', style = '', researchType = '' } = {}) {
  if (cat?.kind !== 'model') return [];
  const done = previous?.paragraphs || {};
  const seen = ids => ids.length && ids.every(id => (done[hashText(blocks.find(b => b.id === id)?.text || '')] || []).includes(cat.id));
  const text = typeof cat.prompt.text === 'function' ? cat.prompt.text(cat.id === 'references' ? { journal, style } : researchType) : cat.prompt.text;
  const req = (key, blockIds, body) => ({ key, blockIds, messages: [{ role: 'system', content: text }, { role: 'user', content: body }] });
  const main = blocks.filter((b, i) => paragraph(b) && roles[i] !== 'references');
  // only the references category carries the cited records (lib/egress-declared.mjs declares it so); every other one sends the text alone
  if (cat.scope === 'paragraph') return main.filter(b => !seen([b.id])).map(b => req(`${cat.id}:${b.id}`, [b.id], fenced('paragraph', `[${b.id}] ${b.text}`)));
  if (cat.scope === 'section') return sectionsOf(blocks, roles).filter(s => !seen(s.blocks.map(b => b.id)))
    .map(s => req(`${cat.id}:${s.heading}`, s.blocks.map(b => b.id), fenced('section', `${s.heading}\n${s.blocks.map(b => (cat.id === 'references' ? unit(b, library) : `[${b.id}] ${b.text}`)).join('\n')}`)));
  const ids = main.map(b => b.id);
  if (!ids.length || seen(ids)) return [];
  const outline = sectionsOf(blocks, roles).map(s => `# ${s.heading}\n${s.blocks.map(b => `[${b.id}] ${clip(b.text, 240)}`).join('\n')}`).join('\n');
  return [req(`${cat.id}:document`, ids, fenced('outline', outline))];
}

/** The findings in a reply: JSON only, each located in the unit it was asked about, each bounded; a reply in another form is one note. */
export function parseFindings(cat, text, blockIds) {
  const s = String(text || ''), a = s.indexOf('{'), z = s.lastIndexOf('}');
  let data = null;
  try { data = a >= 0 ? JSON.parse(s.slice(a, z + 1)) : null; } catch { data = null; }
  if (!data || !Array.isArray(data.findings)) return [{ id: `${cat.id}:form:${blockIds[0] || ''}`, category: cat.id, severity: 'note', blockId: blockIds[0] || '', text: 'The model did not answer in the expected form', suggestion: '' }];
  const allowed = new Set(blockIds);
  return data.findings.filter(f => f && allowed.has(f.block) && SEV.has(f.severity) && clip(f.text, 1)).slice(0, 8)
    .map((f, i) => ({ id: `${cat.id}:${f.block}:${i}`, category: cat.id, severity: f.severity, blockId: f.block, text: clip(f.text, 240), suggestion: clip(f.suggestion, 400) }));
}

/** A rule category's findings, from the checks the app already has. */
export function runRules(cat, { blocks = [], library = [], profile = null, researchType = 'other', facts = '' } = {}) {
  const mk = (sev, blockId, text, suggestion = '') => ({ id: `${cat.id}:${blockId}:${clip(text, 32)}`, category: cat.id, severity: sev, blockId: blockId || '', text: clip(text, 240), suggestion: clip(suggestion, 400) });
  if (cat.id === 'citations') return checkManuscript(blocks, { library }).filter(i => i.kind === 'citation' || i.kind === 'retracted').map(i => mk(i.severity === 'error' ? 'error' : 'warn', i.blockId, i.message));
  if (cat.id === 'reference-list') {
    const keys = [...new Set(blocks.flatMap(b => citations(b.text || '').map(c => c.key)))];
    return keys.map(k => library.find(p => p.key === k)).filter(Boolean).flatMap(p => {
      const name = p.label || p.key, out = [];
      if (!(p.authors || []).length) out.push(mk('error', '', `${name}: no authors on the record`));
      if (!p.journal || !p.year) out.push(mk('error', '', `${name}: the record has no ${!p.journal ? 'journal' : 'year'}`));
      if (!p.doi && !p.pmid) out.push(mk('warn', '', `${name}: no DOI or PMID on the record`, 'Library › Check looks the record up'));
      return out;
    });
  }
  if (cat.id === 'required') return (sectionCheck(blocks, researchType).needed || []).filter(r => !r.found).map(r => mk(r.level === 'section' ? 'warn' : 'note', '', `${r.label} not found`, r.why || ''));
  if (cat.id === 'facts') {
    // The Abstract's and the Results' numbers against what the project computed and counted (`facts`: the results, the PRISMA counts, the
    // included studies and patients, as text). A number not there may still be right (a literature figure, a derived value), so it is a note.
    if (!String(facts || '').trim()) return [];
    let section = '';
    const out = [];
    for (const b of blocks) {
      if (isHead(b)) { section = String(b.text || ''); continue; }
      if (!paragraph(b) || !/abstract|results?|findings/i.test(section)) continue;
      const text = String(b.text).replace(/\[@[^\]]*\]/g, ' ');
      const miss = [...new Set(unsupported(text, facts))].filter(n => !/^(19|20)\d\d$/.test(n) && !/^[0-9]$/.test(n) && !/^\d{7,}$/.test(n));   // a year, a single digit, an identifier (a registration number)
      if (miss.length) out.push(mk('note', b.id, `Not among the project's results: ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ` and ${miss.length - 6} more` : ''}`, 'Check each against the analysis, the flow or the evidence table, or cite its source'));
    }
    return out;
  }
  if (cat.id === 'limits') return profile ? countsAgainstProfile(blocks, profile).filter(r => r.over || r.under).map(r => mk('warn', '', `${r.what}: ${r.value}${r.over ? ' over' : ' under'} the journal's limit`)) : [];
  return [];
}

/** The text of a version: a run is for one version, and a new version is a new run. */
export const versionOf = blocks => hashText((blocks || []).map(b => b.text || '').join('\n'));
/** What a run reviewed: each paragraph's text hash with the categories it was sent for (the next run skips them). */
export function reviewedParagraphs(blocks, sent, before = {}) {
  const out = { ...before };
  for (const { category, blockIds } of sent) for (const id of blockIds) {
    const b = blocks.find(x => x.id === id); if (!b) continue;
    const h = hashText(b.text || ''); out[h] = [...new Set([...(out[h] || []), category])];
  }
  return out;
}
/** state.reviewRuns, newest first, ten at most. */
export function normaliseReviewRuns(list) {
  return (Array.isArray(list) ? list : []).filter(r => r && typeof r === 'object' && r.id && Array.isArray(r.findings))
    .map(r => ({ id: String(r.id), at: String(r.at || ''), version: String(r.version || ''), categories: Array.isArray(r.categories) ? r.categories.map(String) : [],
      findings: r.findings.filter(f => f && f.category && SEV.has(f.severity)).map(f => ({ ...f, text: clip(f.text, 240), suggestion: clip(f.suggestion, 400) })),
      paragraphs: r.paragraphs && typeof r.paragraphs === 'object' && !Array.isArray(r.paragraphs) ? r.paragraphs : {},
      cost: r.cost && typeof r.cost === 'object' ? r.cost : { calls: 0 } }))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
}

/** The project's own numbers as one text the facts rule reads: every result the manuscript can insert, the PRISMA counts, what was included. */
export function projectFacts({ results = [], prisma = {}, included = 0, participants = 0 } = {}) {
  return [...results.map(r => `${r.label || ''} ${r.text || ''}`), ...Object.values(prisma || {}).map(v => String(v ?? '')), `${included} ${participants}`].join('\n');
}

// ---- the supplement (review batch 12 Task 23): rules only, over the manuscript and the supplement's Word file as lib/docx.mjs reads it ----
// "Table S4", "Tables S1 and S2", "Figures S3–S5", "Tables S1, S2 and S4": each number of a mention, a range filled in
const S_REF = /\b(Tables?|Figures?|Figs?\.?)\s+(S\d+(?:\s*(?:,|and|&|[-–]|to)\s*S?\d+)*)/gi;
function sNumbers(list) {
  const out = [], parts = [...list.matchAll(/([-–]|to)?\s*S?(\d+)/gi)];
  parts.forEach((p, i) => { const n = Number(p[2]); if (p[1] && i > 0) { for (let k = out.at(-1) + 1; k < n; k++) out.push(k); } out.push(n); });
  return out;
}
const sLabel = (kind, n) => `${/^t/i.test(kind) ? 'Table' : 'Figure'} S${Number(n)}`;
const textOf = b => String(b?.text ?? '');
const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** "109 patients", "48 studies": each count a text gives of patients or studies, as `noun -> Set(numbers)`. */
function countsOf(texts) {
  const out = { patients: new Set(), studies: new Set() };
  for (const t of texts) for (const m of String(t).matchAll(/\b(\d[\d,]*)\s+(patients|participants|studies|reports)\b/gi)) out[/stud|report/i.test(m[2]) ? 'studies' : 'patients'].add(Number(m[1].replace(/,/g, '')));
  return out;
}

/**
 * Findings of a supplement against its manuscript: an S-table or S-figure the manuscript mentions that the supplement has no caption for
 * (error) and one the supplement holds that the manuscript never mentions (warn); an author-year row of a supplement table no library
 * record matches (warn); a caption that gives a count of patients or studies the manuscript never states (error).
 */
export function supplementChecks({ manuscript = [], supplement = [], library = [] } = {}) {
  const out = [], mk = (sev, blockId, text, suggestion = '') => out.push({ id: `supplement:${blockId}:${clip(text, 32)}`, category: 'supplement', severity: sev, blockId: blockId || '', text: clip(text, 240), suggestion: clip(suggestion, 400) });
  const mentioned = new Map();
  for (const b of manuscript) for (const m of textOf(b).matchAll(S_REF)) for (const n of sNumbers(m[2])) { const l = sLabel(m[1], n); if (!mentioned.has(l)) mentioned.set(l, b.id); }
  const captions = new Map();
  for (const b of supplement) { if (b.type === 'table') continue; const m = /^\s*(?:Supplementa(?:ry|l)\s+)?(Table|Figure|Fig\.?)\s+S(\d+)\b/i.exec(textOf(b)); if (m && !captions.has(sLabel(m[1], m[2]))) captions.set(sLabel(m[1], m[2]), b); }
  for (const [l, id] of mentioned) if (!captions.has(l)) mk('error', id, `${l} is cited but the supplement has no ${l}`, 'Add it to the supplement, or correct the number');
  for (const l of captions.keys()) if (!mentioned.has(l)) mk('warn', '', `${l} is in the supplement but the manuscript never cites it`);
  const families = library.map(p => ({ fam: fold((p.authors || [])[0]?.family || (p.authors || [])[0]?.last || String((p.authors || [])[0] || '').split(/[ ,]/)[0] || String(p.label || '').split(' ')[0]), year: String(p.year || '').slice(0, 4) }));
  const seen = new Set();
  for (const b of supplement.filter(x => x.type === 'table' && x.grid?.rows?.length)) for (const r of b.grid.rows.slice(1)) {
    const lab = studyLabel(r.cells?.[0]?.text || '');
    if (!lab || seen.has(`${lab.family} ${lab.year}`)) continue;
    seen.add(`${lab.family} ${lab.year}`);
    const fam = fold(lab.family).split(/\s+/)[0];
    if (!families.some(f => f.year === lab.year && f.fam && (f.fam === fam || f.fam.startsWith(fam) || fam.startsWith(f.fam)))) mk('warn', '', `${lab.family} ${lab.year} in a supplement table matches no record in the library`, 'Add the record to the library, or cite it beside the row');
  }
  const said = countsOf(manuscript.map(textOf));
  for (const [l, b] of captions) { const c = countsOf([textOf(b)]); for (const noun of ['patients', 'studies']) for (const n of c[noun]) if (said[noun].size && !said[noun].has(n)) mk('error', '', `${l}: ${n} ${noun} in the caption; the manuscript never says ${n} ${noun}`, `The manuscript says ${[...said[noun]].slice(0, 4).join(', ')} ${noun}`); }
  return out;
}

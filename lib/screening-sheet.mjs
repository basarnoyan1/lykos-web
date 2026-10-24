// A screening sheet that carries each reviewer's own columns, read and written (PAPER-COVERAGE F4).
//
// The convention is the one a review team already keeps by hand: per reviewer,
// `Decision (Color)-<name>`, `Reason of Exclusion-<name>` and `Explanation-<name>`
// (a full-text round prefixes "Full-text "), the decision cell filled green
// (92D050) for include, yellow (FFFF00) for uncertain and red (FF0000) for
// exclude. A decision is read from the cell's words first and from its fill when
// the cell has none. Nothing here names a person: the names come from the sheet
// and from the project's own remembered mapping.
//
// Reading and planning are pure (no store, no DOM); applying is one store change.
// The property the tests hold on to: a reviewer's slot (`dual[stage][id][slot]`)
// is written only from that reviewer's columns, so importing one reviewer's sheet
// never changes the other's decisions.
import { headerRow, screeningColumns, decisionOf } from './folder-map.mjs';
import { authorList } from './bib.mjs';
import { update } from '../store.mjs';
import { STAGES, stageOf, isDual, reviewersOf, settleConsensus, conflicts } from './screen.mjs';

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const nameKey = fold;

/** The decision colours of the convention, as the cells are filled. */
export const COLOURS = Object.freeze({ include: '92D050', uncertain: 'FFFF00', exclude: 'FF0000' });
const WORD = Object.freeze({ include: 'Include', uncertain: 'Uncertain', exclude: 'Exclude' });
export const ROLES = Object.freeze([['A', 'Reviewer A'], ['B', 'Reviewer B'], ['model', 'Model'], ['ignore', 'Ignore']]);

/**
 * The decision a cell colour stands for, by hue: green includes, yellow and orange are uncertain, red excludes. White, grey, black
 * and the pale tints of a header or a banded row mean nothing. Returns null for those.
 */
export function fillDecision(fill) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(fill ?? '').trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < 120 || d < 35) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  if (h >= 75 && h <= 170) return 'include';
  if (h >= 30 && h < 75) return 'uncertain';
  if (h < 20 || h >= 340) return 'exclude';
  return null;
}

// ---- the columns --------------------------------------------------------------------------------------------------------
const COLOUR = String.raw`(?:\s*\(colou?r\))?`;
const SEP = String.raw`\s*[-–—:_]\s*`;
const FIELDS = [
  ['decision', new RegExp(String.raw`^decision${COLOUR}(?:${SEP}|\s+)(.+)$`, 'i')],
  ['reason', new RegExp(String.raw`^(?:reason(?:\s+(?:of|for))?\s+exclusion|exclusion\s+reason|reason)${SEP}(.+)$`, 'i')],
  ['explanation', new RegExp(String.raw`^(?:explanation|rationale|comments?|notes?)${SEP}(.+)$`, 'i')],
];
const NAME_FIRST = new RegExp(String.raw`^(.+?)(?:\s*[-–—:_]\s*|\s+)decision${COLOUR}$`, 'i');
const FULL_TEXT = /^full[\s-]?text\s+/i;
// What follows or precedes the word "decision" in a column that is not a person: "Decision date", "Final decision", "Title/abstract decision".
const NOT_A_NAME = /^(date|time|reason|source|type|stage|status|count|by|group|record|color|colour)$|^(title|abstract|full|final|current|overall|consensus|resolved|verdict|model proposal)\b/;

/**
 * The reviewers a sheet's header holds: `[{ name, stage, decision, reason, explanation }]`, the column index of each part (-1 when
 * the sheet has none). A reviewer needs a decision column. Two parts with the same name and stage are one reviewer.
 */
export function reviewerColumns(header = []) {
  const groups = new Map();
  const add = (i, field, stage, raw) => {
    const name = String(raw ?? '').trim().replace(/['’]s$/i, '').trim();
    if (!name || NOT_A_NAME.test(fold(name))) return;
    const key = `${stage}|${fold(name)}`;
    const g = groups.get(key) || { name, stage, decision: -1, reason: -1, explanation: -1 };
    if (g[field] < 0) g[field] = i;
    groups.set(key, g);
  };
  header.forEach((h, i) => {
    let t = String(h ?? '').trim(); if (!t) return;
    let stage = 'ta';
    if (FULL_TEXT.test(t)) { stage = 'ft'; t = t.replace(FULL_TEXT, ''); }
    for (const [field, re] of FIELDS) { const m = re.exec(t); if (m) return add(i, field, stage, m[1]); }
    const m = NAME_FIRST.exec(t); if (m) add(i, 'decision', stage, m[1]);
  });
  return [...groups.values()].filter(g => g.decision >= 0);
}

const colName = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const cell = (r, i) => i >= 0 ? String(r?.[i] ?? '').trim() : '';

/**
 * One sheet (`{ name, rows, cellStyles? }`, as lib/xlsx-edit.mjs openXlsx gives it) as records with each reviewer's cells.
 * `rows[n].cells`: `{ name, stage, decision, reason, note, raw, fromFill }`. Returns null when the sheet has no header.
 */
export function readReviewerSheet(sheet) {
  const rows = sheet?.rows || [], styles = sheet?.cellStyles || {};
  const { index, cells } = headerRow(rows);
  if (index < 0) return null;
  const columns = reviewerColumns(cells);
  const rec = screeningColumns(cells);
  const out = []; let unread = 0, clashes = 0;
  if (rec.title < 0 && rec.doi < 0) return { sheet: sheet?.name || '', header: cells, columns, rows: [], unread, clashes, record: rec };
  rows.slice(index + 1).forEach((r, k) => {
    const title = cell(r, rec.title), doi = cell(r, rec.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
    if (!title && !doi) return;
    const sheetRow = index + 2 + k;
    const found = [];
    for (const g of columns) {
      const raw = cell(r, g.decision);
      const fill = styles[`${colName(g.decision)}${sheetRow}`]?.fill || null;
      const byText = raw ? decisionOf(raw) : null, byFill = fillDecision(fill);
      const decision = byText || byFill;
      if (raw && !byText && !byFill) unread++;
      if (byText && byFill && byText !== byFill) clashes++;
      if (!decision && !raw) continue;
      found.push({ name: g.name, stage: g.stage, decision, raw, fromFill: !byText && !!byFill, reason: cell(r, g.reason), note: cell(r, g.explanation) });
    }
    out.push({ row: sheetRow, title, doi, pmid: cell(r, rec.pmid), authors: cell(r, rec.authors), year: cell(r, rec.year).slice(0, 4), cells: found });
  });
  return { sheet: sheet?.name || '', header: cells, columns, rows: out, unread, clashes, record: rec };
}

/** The sheets of a workbook that hold reviewer columns, the fullest first. `best` is the one to offer. */
export function readReviewerWorkbook(sheets = []) {
  const all = sheets.map(readReviewerSheet).filter(Boolean).filter(p => p.columns.length);
  const rank = p => p.columns.length * 1000 + (/^(decisions?|table|screening)$/i.test(p.sheet) ? 500 : 0) + Math.min(p.rows.length, 499);
  all.sort((a, b) => rank(b) - rank(a));
  return { best: all[0] || null, candidates: all };
}

// ---- who is who -------------------------------------------------------------------------------------------------------------
const MODEL_NAME = /^(jev|model|ai|llm|gpt|chatgpt|claude|gemini|codex|openai|assistant|bot|deepseek|mistral|llama|screener)\b/;

/** The names a sheet's columns carry, in column order, once each. */
export const namesOf = columns => [...new Map(columns.map(g => [fold(g.name), g.name])).entries()].map(([key, name]) => ({ key, name }));

/**
 * What each name in the sheet is, before the person changes it: what the project remembered for that name; otherwise a model when
 * it reads like one or the project holds proposals by it; otherwise Reviewer A when it is the person's own name or initials;
 * otherwise Reviewer B for the first name left, and Ignore for the rest. `me`: `{ key, names }`, the person's initials and names.
 */
export function defaultRoles(columns, state, me = {}) {
  const remembered = state?.screeningSheet?.roles || {};
  const mine = new Set([me.key, ...(me.names || []), ...(me.names || []).map(n => String(n).split(/\s+/)[0])].map(fold).filter(Boolean));
  const proposed = new Set();
  for (const stage of ['ta', 'ft']) for (const p of Object.values(state?.proposals?.[stage] || {})) if (p?.model) proposed.add(fold(p.model));
  const names = namesOf(columns), out = {}, used = new Set();
  for (const { key } of names) { const m = remembered[key]; if (m && ROLES.some(([r]) => r === m.role)) { out[key] = m.role; if (m.role === 'A' || m.role === 'B') used.add(m.role); } }
  for (const { key, name } of names) {
    if (out[key]) continue;
    if (MODEL_NAME.test(key) || proposed.has(key) || /\//.test(name)) out[key] = 'model';
    else if (mine.has(key) && !used.has('A')) { out[key] = 'A'; used.add('A'); }
  }
  // the names left, in column order: Reviewer B first; when the person's own name is unknown, Reviewer A too
  const free = [...(mine.size ? [] : ['A']), 'B'].filter(r => !used.has(r));
  for (const { key } of names) if (!out[key]) out[key] = free.shift() || 'ignore';
  return out;
}

// ---- matching ---------------------------------------------------------------------------------------------------------------
const doiOf = p => String(p.doi || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
function indexPapers(papers) {
  const idx = { doi: new Map(), pmid: new Map(), title: new Map() };
  const put = (m, k, p) => { if (k && !m.has(k)) m.set(k, p); };
  for (const p of papers) { put(idx.doi, doiOf(p), p); put(idx.pmid, String(p.pmid || ''), p); put(idx.title, fold(p.title), p); }
  return idx;
}
const findPaper = (idx, r) => (r.doi && idx.doi.get(r.doi)) || (r.pmid && idx.pmid.get(r.pmid)) || (fold(r.title) && idx.title.get(fold(r.title))) || null;
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

/** A library record for a sheet row no record matches: the same id for the same row, so a second import adds nothing. */
function freshPaper(r) {
  const key = r.doi ? `doi:${r.doi}` : `title:${fold(r.title)}`;
  const authors = r.authors ? r.authors.split(/;\s*|,\s+(?=[A-Z][a-z]+\s+[A-Z])/).map(a => a.trim()).filter(Boolean) : [];
  const fam = String(authors[0] || '').split(/[\s,]+/)[0];
  const id = `sheet-${hash(key)}`;
  return { id, key: id, title: r.title, authors, year: r.year, doi: r.doi, pmid: r.pmid, source: 'sheet', pdf: null, label: `${fam || String(r.title).split(/\s+/)[0] || 'Record'} ${r.year}`.trim() };
}

/** What a reviewer's slot holds for a record now. Decisions made before two reviewers were turned on are Reviewer A's. */
function existingFor(state, stage, id, slot, aKey) {
  const d = state.dual?.[stage]?.[id]?.[slot];
  if (d) return d;
  if (!isDual(state) && slot === aKey) { const c = state[stageOf(stage).key]?.[id]; if (c && !c.resolved && !String(c.by || '').includes('+')) return c; }
  return null;
}

/** Decisions taken before two reviewers were turned on that no slot holds yet: they move into Reviewer A's slot when it is turned on. */
export function legacySingles(state) {
  let n = 0;
  for (const st of STAGES) for (const [id, d] of Object.entries(state[st.key] || {}))
    if (d && !d.resolved && !String(d.by || '').includes('+') && !Object.keys(state.dual?.[st.id]?.[id] || {}).length) n++;
  return n;
}

// ---- the plan -----------------------------------------------------------------------------------------------------------------
/**
 * What importing would do, without doing it. `roles`: { [nameKey]: 'A' | 'B' | 'model' | 'ignore' }; `aKey`: the key Reviewer A's
 * decisions are kept under (the person's initials); Reviewer B's are kept under the column's own name. A decision a slot already holds
 * is kept (counted as `conflicts` when the sheet differs) unless `replace` is set. A model column becomes proposals, never decisions,
 * and never replaces a proposal a live model made.
 */
export function planReviewerImport(state, parsed, roles, { aKey = '', replace = false } = {}) {
  const problems = [];
  const names = namesOf(parsed?.columns || []);
  const by = role => names.filter(n => roles[n.key] === role);
  if (by('A').length > 1) problems.push('More than one column is Reviewer A');
  if (by('B').length > 1) problems.push('More than one column is Reviewer B');
  if (by('A').length && !String(aKey).trim()) problems.push('Reviewer A needs your initials. Set them in Settings');
  const slotOf = n => roles[n.key] === 'A' ? String(aKey).trim() : roles[n.key] === 'B' ? n.name.slice(0, 32) : null;
  if (by('A').length && by('B').length && slotOf(by('A')[0]) === slotOf(by('B')[0])) problems.push('Reviewer A and Reviewer B are the same person');
  if (!names.some(n => ['A', 'B', 'model'].includes(roles[n.key]))) problems.push('Choose a reviewer or model column to import');
  const plan = { problems, legacy: isDual(state) ? 0 : legacySingles(state), rows: parsed?.rows.length || 0, matched: 0, fresh: [], writes: [], unchanged: 0, conflicts: [], modelKept: 0, duplicates: 0, unread: parsed?.unread || 0, clashes: parsed?.clashes || 0,
    slots: { A: by('A')[0] ? slotOf(by('A')[0]) : '', B: by('B')[0] ? slotOf(by('B')[0]) : '' } };
  if (problems.length) return plan;
  const idx = indexPapers(state.papers || []), seen = new Set(), freshIds = new Set(), matched = new Set();
  const label = id => (state.papers || []).find(p => p.id === id)?.label || plan.fresh.find(p => p.id === id)?.label || id;
  for (const r of parsed.rows) {
    const cells = r.cells.filter(c => c.decision && ['A', 'B', 'model'].includes(roles[fold(c.name)]));
    if (!cells.length) continue;
    let paper = findPaper(idx, r);
    if (!paper) paper = freshPaper(r);
    const isNew = freshIds.has(paper.id) || !(state.papers || []).some(p => p.id === paper.id);
    for (const c of cells) {
      const role = roles[fold(c.name)], tag = `${role}|${c.stage}|${paper.id}|${fold(c.name)}`;
      if (seen.has(tag)) { plan.duplicates++; continue; }
      seen.add(tag);
      const reason = c.decision === 'exclude' ? (c.reason || 'Excluded in the screening sheet') : '';
      if (role === 'model') {
        const have = state.proposals?.[c.stage]?.[paper.id];
        if (have && !(have.tier === 'sheet' && fold(have.model) === fold(c.name))) { plan.modelKept++; continue; }
        if (have && have.verdict === c.decision) { plan.unchanged++; continue; }
        plan.writes.push({ kind: 'model', stage: c.stage, id: paper.id, model: c.name, decision: c.decision, reason, note: c.note });
      } else {
        const slot = role === 'A' ? String(aKey).trim() : c.name.slice(0, 32);
        const have = isNew ? null : existingFor(state, c.stage, paper.id, slot, String(aKey).trim());
        if (have && have.decision === c.decision) { plan.unchanged++; continue; }
        if (have && !replace) { plan.conflicts.push({ kind: 'differs', stage: c.stage, id: paper.id, label: label(paper.id), name: c.name, slot, sheet: c.decision, app: have.decision }); continue; }
        plan.writes.push({ kind: 'person', stage: c.stage, id: paper.id, slot, role, decision: c.decision, reason, note: c.note, ...(have ? { replaces: have.decision } : {}) });
      }
      if (isNew && !freshIds.has(paper.id)) { freshIds.add(paper.id); plan.fresh.push(paper); idx.doi.set(doiOf(paper), paper); idx.title.set(fold(paper.title), paper); }
    }
    if (!isNew) matched.add(paper.id);
  }
  plan.matched = matched.size;
  return plan;
}

// ---- applying -----------------------------------------------------------------------------------------------------------------
/**
 * Decisions made before two reviewers were turned on become Reviewer A's, in the slot, so turning them on hides nothing: `ids` limits
 * it to those records. A resolved conflict, a consensus and a record that already has slots are left as they are.
 */
function migrateSingle(s, aKey, ids = null) {
  for (const st of STAGES) {
    const key = st.key;
    for (const [id, d] of Object.entries(s[key] || {})) {
      if (ids && !ids.has(`${st.id}|${id}`)) continue;
      if (!d || d.resolved || String(d.by || '').includes('+') || Object.keys(s.dual?.[st.id]?.[id] || {}).length) continue;
      if (!(s.papers || []).some(p => p.id === id)) continue;
      s.dual = s.dual || {}; (s.dual[st.id] ||= {}); (s.dual[st.id][id] ||= {});
      const { by, ...own } = d;
      s.dual[st.id][id][aKey] = own;
    }
  }
}

/**
 * Does the plan: new records added, decisions written into their slots (logged one by one), model columns kept as proposals,
 * the consensus settled for the records touched, and the mapping remembered for the project. Returns the counts and the records
 * where the two reviewers now differ.
 */
export function applyReviewerImport(plan, { roles = {}, columns = [], aKey = '', enableDual = false, file = '' } = {}) {
  if (plan.problems?.length) throw new Error(plan.problems[0]);
  const at = new Date().toISOString();
  const touched = new Set();
  update(s => {
    const persons = plan.writes.some(w => w.kind === 'person');
    const turnOn = persons && enableDual && !isDual(s);
    if (turnOn && !aKey && legacySingles(s)) throw new Error('Your initials are needed to keep your earlier decisions. Set them in Settings');
    if (turnOn) { s.settings = { ...(s.settings || {}), dualScreening: true }; migrateSingle(s, aKey); }
    const dual = isDual(s);
    s.papers = s.papers || [];
    for (const p of plan.fresh) if (!s.papers.some(x => x.id === p.id)) s.papers.push(structuredClone(p));
    s.screeningLog = s.screeningLog || [];
    const ids = new Set(plan.writes.filter(w => w.kind === 'person').map(w => `${w.stage}|${w.id}`));
    if (dual && !turnOn && aKey) migrateSingle(s, aKey, ids);
    for (const w of plan.writes) {
      if (w.kind === 'model') {
        s.proposals = s.proposals || {}; (s.proposals[w.stage] ||= {});
        s.proposals[w.stage][w.id] = { verdict: w.decision, p: null, criteria: [], model: w.model, at, tier: 'sheet', ...(w.reason ? { reason: w.reason } : {}), ...(w.note ? { triageNote: w.note } : {}) };
        continue;
      }
      s.dual = s.dual || {}; (s.dual[w.stage] ||= {}); (s.dual[w.stage][w.id] ||= {});
      const prior = s.dual[w.stage][w.id][w.slot];
      s.dual[w.stage][w.id][w.slot] = { decision: w.decision, reason: w.reason, at, via: 'sheet', ...(w.note ? { note: w.note } : {}) };
      s.screeningLog.push({ action: prior ? 'change' : 'decide', stage: w.stage, id: w.id, decision: w.decision, reason: w.reason, by: w.slot, prior: prior?.decision, via: 'sheet', at });
      touched.add(`${w.stage}|${w.id}`);
    }
    if (dual) for (const t of touched) { const [st, id] = t.split('|'); settleConsensus(s, st, id); }
    const remembered = { ...(s.screeningSheet?.roles || {}) };
    for (const n of namesOf(columns)) if (roles[n.key]) remembered[n.key] = { name: n.name, role: roles[n.key], ...(roles[n.key] === 'A' ? { slot: aKey } : roles[n.key] === 'B' ? { slot: n.name.slice(0, 32) } : {}) };
    s.screeningSheet = { ...(s.screeningSheet || {}), roles: remembered, last: { file: String(file).slice(0, 200), at } };
    return s;
  });
  return { touched: [...touched] };
}

/** The records among `touched` ("stage|id") where two reviewers now differ with nobody to settle it. */
export function disagreements(state, touched = []) {
  const want = new Set(touched);
  return STAGES.flatMap(st => conflicts(state, st.id).filter(c => want.has(`${st.id}|${c.paper.id}`))
    .map(c => ({ kind: 'disagree', stage: st.id, id: c.paper.id, label: c.paper.label || c.paper.title, decisions: c.decisions.map(d => ({ by: d.by, decision: d.decision })) })));
}

// ---- the sheet we write ---------------------------------------------------------------------------------------------------
const failedRules = (pr, rules) => {
  const kindOf = id => rules.find(r => r.id === id)?.kind || 'include';
  return (pr?.criteria || []).filter(c => (kindOf(c.id) === 'include' && c.met === 'no') || (kindOf(c.id) === 'exclude' && c.met === 'yes'))
    .map(c => `${c.id}: ${rules.find(r => r.id === c.id)?.text || ''}`.trim());
};

/** The name a reviewer's columns carry in the sheet: the name the project remembered for that slot, else the slot itself. */
export function sheetNameOf(state, slot) {
  const hit = Object.values(state?.screeningSheet?.roles || {}).find(r => r.slot && r.slot === slot);
  return hit?.name || slot;
}

/** The people whose decisions a stage holds, as `{ slot, name, get(id) }`. One reviewer's own decisions when screening is single. */
function peopleOf(s, stage) {
  const key = stageOf(stage).key;
  const slots = reviewersOf(s, stage);
  if (isDual(s) || slots.length) return slots.map(slot => ({ slot, name: sheetNameOf(s, slot), get: id => s.dual?.[stage]?.[id]?.[slot] || null }));
  const held = Object.values(s[key] || {});
  if (!held.length) return [];
  const counts = new Map();
  for (const d of held) { const b = String(d.by || '').trim(); if (b && !/^(sheet|folder)$/.test(b) && !b.includes('+')) counts.set(b, (counts.get(b) || 0) + 1); }
  const slot = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || String(s.settings?.reviewerInitials || '').trim() || 'Reviewer';
  return [{ slot, name: sheetNameOf(s, slot), get: id => s[key]?.[id] || null }];
}
/** The models whose proposals a stage holds. A re-screen result is not a proposal made under the review's rules and is not written. */
function modelsOf(s, stage) {
  const names = new Map();
  for (const p of Object.values(s.proposals?.[stage] || {})) if (p?.model && ['include', 'exclude', 'uncertain'].includes(p.verdict)) names.set(p.model, (names.get(p.model) || 0) + 1);
  return [...names.keys()].sort();
}

/**
 * The Decisions sheet: the record's identity, then per reviewer and per model its three columns in the convention's words, then the
 * review's verdict. Decision cells are filled by the convention. Returns `{ name, rows, styleOf }` for lib/xlsx-write.mjs.
 */
export function decisionsSheet(s) {
  const papers = s.papers || [], rules = s.protocol?.criteria || [];
  const head = ['Record #', 'Label', 'Title', 'Authors', 'Year', 'Journal', 'DOI', 'PMID'];
  const paint = new Set();            // columns whose cells carry a decision
  const parts = [];                   // [header, (paper) => cell]
  const group = (stage, name, get) => {
    const pre = stage === 'ft' ? 'Full-text ' : '';
    const first = stage === 'ft' ? ['decision (Color)', 'reason of exclusion', 'explanation'] : ['Decision (Color)', 'Reason of Exclusion', 'Explanation'];
    paint.add(head.length + parts.length);
    parts.push([`${pre}${first[0]}-${name}`, p => { const d = get(p); return d ? WORD[d.decision] || '' : ''; }]);
    parts.push([`${pre}${first[1]}-${name}`, p => { const d = get(p); return d?.decision === 'exclude' ? d.reason || '' : ''; }]);
    parts.push([`${pre}${first[2]}-${name}`, p => get(p)?.note || '']);
  };
  for (const st of STAGES) {
    for (const person of peopleOf(s, st.id)) group(st.id, person.name, p => person.get(p.id));
    for (const model of modelsOf(s, st.id)) {
      const pr = p => { const x = s.proposals?.[st.id]?.[p.id]; return x?.model === model ? x : null; };
      group(st.id, model, p => { const x = pr(p); return x && { decision: x.verdict, reason: x.verdict === 'exclude' ? (failedRules(x, rules)[0] || x.reason || x.exclusionCategory || '') : '', note: x.triageNote || x.note || '' }; });
    }
  }
  const finalCols = [['ta', 'screening', 'Verdict', 'Verdict reason']];
  if (Object.keys(s.fulltext || {}).length) finalCols.push(['ft', 'fulltext', 'Full-text verdict', 'Full-text reason']);
  for (const [, key, name, why] of finalCols) {
    paint.add(head.length + parts.length);
    parts.push([name, p => WORD[s[key]?.[p.id]?.decision] || '']);
    parts.push([why, p => s[key]?.[p.id]?.decision === 'exclude' ? s[key][p.id].reason || '' : '']);
  }
  const rows = [[...head, ...parts.map(x => x[0])]];
  papers.forEach((p, i) => rows.push([i + 1, p.label || '', p.title || '', authorList(p.authors).join('; '), String(p.year || ''), p.journal || '', p.doi || '', p.pmid || '', ...parts.map(x => x[1](p))]));
  const styleOf = (i, c) => {
    if (i === 0) return 'head';
    if (!paint.has(c)) return 'body';
    const word = String(rows[i]?.[c] ?? '').toLowerCase();
    return COLOURS[word] ? word : 'body';
  };
  return { name: 'Decisions', rows, styleOf };
}

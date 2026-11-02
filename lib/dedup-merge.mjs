// Merging a duplicate record into the one kept, and undoing it (moved out of lib/dedup-core.mjs on 31 Oct 2026, which the shell's
// first view loads for the Library's Duplicates filter). Nothing merges without a person or a change file.

import { lib_search_library$addMainRecords as addMainRecords } from "../boot.mjs";

function containsId(value, id, seen = new WeakSet()) {
  if (typeof value === 'string')
    return value === id || value.includes(`[@${id}]`) || value.includes(`[@${id} `);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) =>
    key === id || key.startsWith(`${id}:`) || containsId(child, id, seen));
}

// Screening decisions follow a merge (31 Oct 2026): the sham review's Scopus v3 import left 143 duplicates that had already been
// screened, and the merge refused them as "linked screening". A decision is never lost: each stage keeps the more advanced
// decision (include over exclude, and either over uncertain, which is undecided), with its own history, and a conflict is written into the kept decision's note
// beside the other record's decision. The decisions as they were are kept on the merge, so an unmerge puts both back. A protocol scenario's
// own decisions (s.scenarioScreening, 1 Nov 2026) follow the same way.
const STAGE_KEYS = [['ta', 'screening', 'title and abstract'], ['ft', 'fulltext', 'full text']];
// uncertain is undecided (lib/prisma-counts.mjs pending): any decision is more advanced than it, and include than exclude
const RANK = { include: 3, exclude: 2, uncertain: 1 };
const rank = d => RANK[d?.decision] || 0;
const said = d => `${d.decision}${d.reason ? ` (${d.reason})` : ''}`;
// what a merge moves itself; any other area that names the duplicate is linked work the merge refuses
const MOVED = ['papers', 'merged', 'dedupDismissed', 'libraryTrash', 'settings', 'screening', 'fulltext', 'screeningLog', 'dual', 'scenarioScreening', 'scenarioPapers', 'scenarioMerged'];

// the decision a stage keeps when two records merge: the more advanced, the other written into its note
function combine(k, d, keep, dup, name) {
  if (!k) return { kept: { ...d }, from: dup.id };
  if (k.decision === d.decision) return { kept: k, from: keep.id };
  const dupWins = rank(d) > rank(k), win = dupWins ? d : k, lose = dupWins ? k : d;
  const line = `Merged with ${dupWins ? keep.label || keep.id : dup.label || dup.id} (${dupWins ? keep.id : dup.id}), whose ${name} decision was ${said(lose)}${lose.at ? ` on ${String(lose.at).slice(0, 10)}` : ''}; ${win.decision} kept as the more advanced decision.`;
  return { kept: { ...win, note: [win.note, line].filter(Boolean).join(' | ') }, from: dupWins ? dup.id : keep.id, conflict: `${name}: ${said(win)} kept over ${said(lose)}` };
}

function mergeDecisions(s, keep, dup, at, { main = true } = {}) {
  const saved = {}, notes = [];
  // main's decisions only between main's records: a protocol scenario's own records (s.scenarioPapers) take none
  for (const [stage, key, name] of main ? STAGE_KEYS : []) {
    const k = s[key]?.[keep.id], d = s[key]?.[dup.id];
    if (!d) continue;
    saved[key] = { keep: k ? structuredClone(k) : null, dup: structuredClone(d) };
    s[key] = s[key] || {};
    delete s[key][dup.id];
    const { kept, from, conflict } = combine(k, d, keep, dup, name);
    if (conflict) notes.push(conflict);
    s[key][keep.id] = kept;
    saved[key].after = structuredClone(kept);
    s.screeningLog = [...(s.screeningLog || []), { action: 'merge', stage, id: keep.id, from: dup.id, decision: kept.decision,
      ...(k ? { prior: k.decision } : {}), other: d.decision, kept: from, at }];
  }
  // a protocol scenario's own decisions (lib/scenarios.mjs, s.scenarioScreening) follow as main's do, scenario by scenario
  for (const [sc, lane] of Object.entries(s.scenarioScreening || {})) for (const [stage, , name] of STAGE_KEYS) {
    const byId = lane?.[stage], d = byId?.[dup.id];
    if (!d) continue;
    const k = byId[keep.id], { kept, from } = combine(k, d, keep, dup, name);
    delete byId[dup.id];
    byId[keep.id] = kept;
    ((saved.scenarioScreening ||= {})[sc] ||= {})[stage] = { keep: k ? structuredClone(k) : null, dup: structuredClone(d), after: structuredClone(kept) };
    s.screeningLog = [...(s.screeningLog || []), { action: 'merge', stage, id: keep.id, from: dup.id, decision: kept.decision,
      ...(k ? { prior: k.decision } : {}), other: d.decision, kept: from, scenario: sc, at }];
  }
  // two reviewers' own decisions (main's only): the duplicate's move across where the kept record has none from that reviewer
  for (const [stage, byId] of Object.entries(main ? s.dual || {} : {})) {
    const d = byId?.[dup.id];
    if (!d) continue;
    saved.dual = { ...(saved.dual || {}), [stage]: { keep: byId[keep.id] ? structuredClone(byId[keep.id]) : null, dup: structuredClone(d) } };
    byId[keep.id] = { ...d, ...(byId[keep.id] || {}) };
    delete byId[dup.id];
  }
  return { saved, notes };
}

// where a record is: main's (s.papers, its merges s.merged) or one only a protocol scenario's runs found (s.scenarioPapers, s.scenarioMerged)
function sectionOf(s, id) {
  for (const [list, merged] of [['papers', 'merged'], ['scenarioPapers', 'scenarioMerged']]) {
    const rec = (s[list] || []).find(p => p.id === id);
    if (rec) return { list, merged, rec };
  }
  return null;
}

/**
 * Merges a duplicate record into the one kept. Fails before changing anything when linked work would be lost (values,
 * appraisals and other areas that name the duplicate, a PDF only the duplicate has, another record that cites it), or when the
 * duplicate has itself absorbed records (keep it instead). The kept record may already hold earlier merges. Screening decisions
 * follow (mergeDecisions); the duplicate's databases stay counted through `s.merged` (lib/prisma-counts.mjs flowArms). Two records
 * only a protocol scenario's runs found merge the same way in their own section (s.scenarioPapers, s.scenarioMerged). A scenario's record
 * found to be one of main's is merged into main's record, whichever was named to keep, and main's numbers do not move: nothing is
 * copied onto main's record, the merge is the scenario's (s.scenarioMerged), and main's record holds the scenario's decisions on it.
 */
export function mergeRecords(s, keepId, dupId) {
  if (keepId === dupId) throw new Error('Choose two different records.');
  let k = sectionOf(s, keepId), d = sectionOf(s, dupId);
  if (!k || !d) throw new Error('A record is no longer in the library.');
  const across = k.list !== d.list;
  if (across && k.list !== 'papers') [k, d] = [d, k];
  const keep = k.rec, dup = d.rec;
  keepId = keep.id; dupId = dup.id;
  if (dup.mergedFrom?.length)
    throw new Error('The record being removed holds earlier merges. Keep that record instead, or undo its merges first.');
  if (dup.pdf && !keep.pdf)
    throw new Error('The record being removed owns a PDF. Keep that record instead.');
  // a record that names the duplicate only as one it absorbed earlier (an id a later import brought back) is not a link
  // nor is the kept record's own mark that it is a duplicate of this one (lib/identify.mjs duplicateOf): the merge settles it
  const settles = !across && keep.duplicateOf === dupId;
  if ([...(s.papers || []), ...(s.scenarioPapers || [])].some(p => p.id !== dupId && containsId({ ...p, mergedFrom: undefined, ...(p === keep && settles ? { duplicateOf: undefined } : {}) }, dupId)))
    throw new Error('Another record links to this record. Keep this record instead.');
  for (const [area, value] of Object.entries(s)) {
    if (MOVED.includes(area)) continue;
    if (containsId(value, dupId)) throw new Error(`This record has linked ${area}. Keep that record instead.`);
  }
  const at = new Date().toISOString();
  const index = s[d.list].findIndex(p => p.id === dupId);
  if (across) {
    const { saved } = mergeDecisions(s, keep, dup, at, { main: false });
    s.scenarioPapers = s.scenarioPapers.filter(p => p.id !== dupId);
    s.scenarioMerged = [...(s.scenarioMerged || []), { keepId, dup, at, index, across: true, ...(Object.keys(saved).length ? { decisions: saved } : {}) }];
    return s;
  }
  const copied = {};
  for (const field of ['doi', 'pmid', 'journal', 'year', 'volume', 'issue', 'pages', 'url', 'abstract']) {
    if (!keep[field] && dup[field]) { copied[field] = dup[field]; keep[field] = dup[field]; }
  }
  const { saved, notes } = mergeDecisions(s, keep, dup, at, { main: k.list === 'papers' });
  const marks = settles ? { duplicateOf: keep.duplicateOf, ...(keep.identified ? { identified: keep.identified } : {}) } : null;
  if (settles) { delete keep.duplicateOf; if (keep.identified === 'duplicate') delete keep.identified; }
  keep.mergedFrom = [...(keep.mergedFrom || []), { id: dupId, at, copied, ...(notes.length ? { conflicts: notes } : {}), ...(marks ? { marks } : {}) }];
  s[k.list] = s[k.list].filter(p => p.id !== dupId);
  s[k.merged] = [...(s[k.merged] || []), { keepId, dup, at, index, ...(Object.keys(saved).length ? { decisions: saved } : {}) }];
  return s;
}

export function unmergeRecords(s, keepId, dupId) {
  // the latest merge of this pair (a record a later import brought back can be merged into the same record again), main's or a scenario's
  const find = key => (s[key] || []).findLastIndex(m => m.keepId === keepId && m.dup.id === dupId);
  const mergedKey = find('merged') >= 0 ? 'merged' : 'scenarioMerged', at = find(mergedKey);
  const entry = at < 0 ? null : s[mergedKey][at];
  // a copy repaired on load (lib/search-library.mjs separateRecords) has main's id: it never goes back beside it
  if (!entry || entry.repaired) return s;
  // a scenario's record merged into main's (across) goes back to the scenario's records; nothing on main's record changed
  const listKey = mergedKey === 'merged' ? 'papers' : 'scenarioPapers';
  const keep = entry.across ? null : (s[listKey] || []).find(p => p.id === keepId);
  if (keep) {
    const record = (keep.mergedFrom || []).findLast(m => m.id === dupId);
    if (record?.copied) {
      for (const [field, value] of Object.entries(record.copied))
        if (keep[field] === value) delete keep[field];
    } else if (record?.before) {
      // Earlier versions saved a full before snapshot.
      for (const field of ['doi', 'pmid', 'journal', 'year', 'pdf', 'pdfName', 'authors', 'abstract', 'language']) {
        const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
        if (same(keep[field], entry.dup[field]) && !same(record.before[field], entry.dup[field])) {
          if (Object.hasOwn(record.before, field)) keep[field] = record.before[field];
          else delete keep[field];
        }
      }
    }
    if (record?.marks) Object.assign(keep, record.marks);
    const i = (keep.mergedFrom || []).lastIndexOf(record);
    keep.mergedFrom = (keep.mergedFrom || []).filter((m, j) => j !== i);
  }
  // the decisions as they were before the merge: the kept record's back (unless changed since), the duplicate's back to it
  const now = new Date().toISOString();
  for (const [stage, key] of STAGE_KEYS) {
    const d = entry.decisions?.[key];
    if (!d) continue;
    s[key] = s[key] || {};
    // a decision made on the kept record since the merge stays
    if (!d.after || JSON.stringify(s[key][keepId]) === JSON.stringify(d.after)) { if (d.keep) s[key][keepId] = d.keep; else delete s[key][keepId]; }
    s[key][dupId] = d.dup;
    s.screeningLog = [...(s.screeningLog || []), { action: 'unmerge', stage, id: keepId, from: dupId, decision: d.dup.decision, at: now }];
  }
  for (const [sc, lane] of Object.entries(entry.decisions?.scenarioScreening || {})) for (const [stage, d] of Object.entries(lane || {})) {
    const byId = ((s.scenarioScreening ||= {})[sc] ||= {})[stage] ||= {};
    if (!d.after || JSON.stringify(byId[keepId]) === JSON.stringify(d.after)) { if (d.keep) byId[keepId] = d.keep; else delete byId[keepId]; }
    byId[dupId] = d.dup;
    s.screeningLog = [...(s.screeningLog || []), { action: 'unmerge', stage, id: keepId, from: dupId, decision: d.dup.decision, scenario: sc, at: now }];
  }
  for (const [stage, d] of Object.entries(entry.decisions?.dual || {})) {
    const byId = (s.dual ||= {})[stage] ||= {};
    if (d.keep) byId[keepId] = d.keep; else delete byId[keepId];
    byId[dupId] = d.dup;
  }
  const list = s[listKey] ||= [];
  if (!list.some(p => p.id === dupId)) {
    const at = Math.min(entry.index ?? list.length, list.length);
    if (listKey === 'papers') addMainRecords(s, [entry.dup], { at }); else list.splice(at, 0, entry.dup);
  }
  s[mergedKey] = (s[mergedKey] || []).filter((m, j) => j !== at);
  return s;
}
